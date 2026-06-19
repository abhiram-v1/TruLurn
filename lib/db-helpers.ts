import { getDb } from '@/lib/db'
import { invalidateCourse } from '@/lib/cache/courseData'
import {
  mockBranches,
  mockCourse,
  mockTopics,
  mockPages,
  mockDoubts,
  mockQuestions,
} from '@/lib/mock-data'

function isStructuralTopic(topic: any) {
  return String(topic.node_type ?? '') === 'container' || Number(topic.children_count ?? 0) > 0
}

export async function seedDefaultCourse() {
  const db = await getDb()

  // Check if course already exists
  const existingCourse = await db.collection('courses').findOne({ _id: mockCourse.id as any })
  if (existingCourse) {
    return // Already seeded
  }

  console.log('Seeding database with default Machine Learning course...')

  // Insert Course
  await db.collection('courses').insertOne({
    _id: mockCourse.id as any,
    user_id: mockCourse.user_id,
    title: mockCourse.title,
    topic: mockCourse.topic,
    goals: mockCourse.goals,
    mode: mockCourse.mode,
    created_at: new Date(mockCourse.created_at),
  })

  // Insert Branches
  const branches = mockBranches.map((branch) => ({
    _id: branch.id as any,
    course_id: branch.course_id,
    title: branch.title,
    description: branch.description,
    state: branch.state,
    active_topic_id: branch.active_topic_id,
    topic_count: branch.topic_count,
    mastered_count: branch.mastered_count,
  }))
  await db.collection('branches').insertMany(branches)

  // Insert Topics
  const topics = mockTopics.map((topic) => ({
    _id: topic.id as any,
    course_id: topic.course_id,
    branch_id: topic.branch_id,
    section: topic.section,
    title: topic.title,
    parent_id: topic.parent_id,
    position: topic.position,
    state: topic.state,
    understanding_level: topic.understanding_level,
    prerequisites: topic.prerequisites,
    created_at: new Date(topic.created_at),
  }))
  await db.collection('topics').insertMany(topics)

  // Insert Pages
  const pages = mockPages.map((page) => ({
    _id: page.id as any,
    topic_id: page.topic_id,
    page_number: page.page_number,
    content: page.content,
    created_at: new Date(page.created_at),
  }))
  await db.collection('pages').insertMany(pages)

  // Insert Doubt Messages
  const doubtMessages = mockDoubts.map((doubt) => ({
    _id: doubt.id as any,
    topic_id: doubt.topic_id,
    page_number: doubt.page_number,
    role: doubt.role,
    content: doubt.content,
    created_at: new Date(doubt.created_at),
  }))
  await db.collection('doubtMessages').insertMany(doubtMessages)

  // Insert Quiz Questions
  const quizQuestions = mockQuestions.map((q) => ({
    _id: q.id as any,
    topic_id: q.topic_id,
    type: q.type,
    question: q.question,
    rubric: q.rubric,
    created_at: new Date(q.created_at),
  }))
  await db.collection('quizQuestions').insertMany(quizQuestions)

  console.log('Database seeded successfully.')
}

export async function unlockNextTopics(courseId: string, completedTopicId: string) {
  const db = await getDb()

  // Do NOT force state/understanding_level here — the graph evaluator in
  // quiz/evaluate sets the correct level-based state (partial/functional/mastered)
  // after this function returns. Hardcoding mastered/5 here conflicts with that.
  // The prerequisite check below already special-cases completedTopicId so the
  // unlock logic works correctly without first writing the state.

  // 1. Fetch all topics for this course
  const allTopics = await db.collection('topics').find({ course_id: courseId }).toArray()

  const masteredTopicIds = new Set(
    allTopics
      .filter((t) => !isStructuralTopic(t) && (t.state === 'mastered' || t.state === 'functional' || String(t._id) === completedTopicId))
      .map((t) => String(t._id))
  )

  // 3. Find topics that are locked and whose prerequisites are all met
  for (const topic of allTopics) {
    if (topic.state === 'locked' && !isStructuralTopic(topic)) {
      const prereqs = (topic.prerequisites || []) as string[]
      const allMet = prereqs.every((pId) => masteredTopicIds.has(pId))
      if (allMet) {
        await db.collection('topics').updateOne(
          { _id: topic._id },
          { $set: { state: 'active' } }
        )
        // Update local status for the branch calculation below
        topic.state = 'active'
      }
    }
  }

  // 4. Update the Branches state and topic counts
  const allBranches = await db.collection('branches').find({ course_id: courseId }).toArray()
  const updatedTopics = await db.collection('topics').find({ course_id: courseId }).toArray()

  for (const branch of allBranches) {
    const branchKey = String(branch.branch_key ?? branch._id)
    const branchTopics = updatedTopics
      .filter((t) => String(t.branch_id) === branchKey || String(t.branch_id) === String(branch._id))
      .filter((t) => !isStructuralTopic(t))
    const totalCount = branchTopics.length
    const masteredCount = branchTopics.filter((t) => t.state === 'mastered').length
    
    let newState = 'not_started'
    if (masteredCount === totalCount && totalCount > 0) {
      newState = 'mastered'
    } else if (masteredCount > 0 || branchTopics.some((t) => t.state === 'active')) {
      newState = 'in_progress'
    }

    // Find the first active or mastered topic to set as active_topic_id
    const activeTopic = branchTopics.find((t) => t.state === 'active') || branchTopics[0]

    await db.collection('branches').updateOne(
      { _id: branch._id },
      {
        $set: {
          state: newState,
          mastered_count: masteredCount,
          topic_count: totalCount,
          active_topic_id: activeTopic ? String(activeTopic._id) : null,
        },
      }
    )
  }

  // Topic/branch states changed — drop cached course structure + graph payload.
  invalidateCourse(courseId)
}
