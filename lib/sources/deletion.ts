import crypto from 'crypto'
import { GridFSBucket, ObjectId, type Db } from 'mongodb'

const SOURCE_OBJECT_BUCKET = 'sourceObjects'

export const COURSE_LINEAGE_COLLECTIONS = [
  'branches',
  'topics',
  'topicEdges',
  'curricula',
  'courseSummaries',
  'courseResearchReports',
  'topicSummaries',
  'pages',
  'pageSummaries',
  'doubtMessages',
  'quizQuestions',
  'quizAttempts',
  'examSessions',
  'examTurns',
  'sourceChunks',
  'sourceDocuments',
  'sourceDocumentVersions',
  'sourceIngestionJobs',
  'sourceBlocks',
  'sourcePassages',
  'generationJobs',
  'learningEvents',
  'lessonFeedback',
  'reviewSchedule',
  'studySessions',
  'recallSessions',
  'taggedReminders',
  'learnerProfiles',
  'learnerMemories',
  'learnerSkillStates',
  'learnerMisconceptionStates',
  'learnerMemorySyncStates',
  'retrievalTraces',
  'userConnections',
  'agent_forward_refs',
] as const

function validObjectIds(values: unknown[]) {
  return values
    .map(String)
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value))
}

export async function validateCourseDeletion(
  db: Db,
  input: {
    userId: string
    courseId: string
    sourceObjectIds?: unknown[]
  },
) {
  const collectionCounts = Object.fromEntries(await Promise.all(
    COURSE_LINEAGE_COLLECTIONS.map(async (collection) => [
      collection,
      await db.collection(collection).countDocuments({ course_id: input.courseId }),
    ]),
  ))
  const courses = await db.collection('courses').countDocuments({
    _id: input.courseId as any,
    user_id: input.userId,
  })
  const objectIds = validObjectIds(input.sourceObjectIds ?? [])
  const sourceObjects = objectIds.length
    ? await db.collection(`${SOURCE_OBJECT_BUCKET}.files`).countDocuments({
        _id: { $in: objectIds },
      })
    : 0
  const sourceObjectChunks = objectIds.length
    ? await db.collection(`${SOURCE_OBJECT_BUCKET}.chunks`).countDocuments({
        files_id: { $in: objectIds },
      })
    : 0
  const remaining = {
    courses,
    ...collectionCounts,
    sourceObjects,
    sourceObjectChunks,
  }
  const passed = Object.values(remaining).every((count) => Number(count) === 0)

  return { passed, remaining }
}

export async function deleteCourseWithLineage(
  db: Db,
  input: {
    userId: string
    courseId: string
  },
) {
  const versions = await db.collection('sourceDocumentVersions')
    .find({
      user_id: input.userId,
      course_id: input.courseId,
    })
    .project({ 'object_store.object_id': 1 })
    .toArray()
  const sourceObjectIds = versions
    .map((version) => version.object_store?.object_id)
    .filter(Boolean)
  const bucket = new GridFSBucket(db, { bucketName: SOURCE_OBJECT_BUCKET })
  const objectDeletionResults = await Promise.allSettled(
    validObjectIds(sourceObjectIds).map((objectId) => bucket.delete(objectId)),
  )

  const deleteResults = await Promise.all(
    COURSE_LINEAGE_COLLECTIONS.map(async (collectionName) => {
      const result = await db.collection(collectionName).deleteMany({
        course_id: input.courseId,
      })
      return [collectionName, result.deletedCount] as const
    }),
  )
  const courseResult = await db.collection('courses').deleteOne({
    _id: input.courseId as any,
    user_id: input.userId,
  })
  const validation = await validateCourseDeletion(db, {
    ...input,
    sourceObjectIds,
  })

  await db.collection('deletionValidationRuns').insertOne({
    _id: crypto.randomUUID() as any,
    user_id: input.userId,
    course_id: input.courseId,
    validation_version: 'course-lineage-v1',
    passed: validation.passed,
    remaining: validation.remaining,
    source_object_delete_failures: objectDeletionResults.filter(
      (result) => result.status === 'rejected',
    ).length,
    created_at: new Date(),
  })

  return {
    deleted: validation.passed,
    counts: {
      courses: courseResult.deletedCount,
      ...Object.fromEntries(deleteResults),
      sourceObjects: objectDeletionResults.filter(
        (result) => result.status === 'fulfilled',
      ).length,
    },
    validation,
  }
}

export async function auditUserDeletionLineage(db: Db, userId: string) {
  const courses = await db.collection('courses')
    .find({ user_id: userId })
    .project({ _id: 1 })
    .toArray()
  const activeCourseIds = new Set(courses.map((course) => String(course._id)))
  const orphanCounts: Record<string, number> = {}

  for (const collection of [
    'sourceDocuments',
    'sourceDocumentVersions',
    'sourceBlocks',
    'sourcePassages',
    'sourceChunks',
    'retrievalTraces',
  ]) {
    const courseIds = await db.collection(collection).distinct('course_id', {
      user_id: userId,
      course_id: { $nin: [null, ''] },
    })
    const orphanIds = courseIds.map(String).filter((courseId) => !activeCourseIds.has(courseId))
    orphanCounts[collection] = orphanIds.length
      ? await db.collection(collection).countDocuments({
          user_id: userId,
          course_id: { $in: orphanIds },
        })
      : 0
  }

  const [versions, storedFiles] = await Promise.all([
    db.collection('sourceDocumentVersions')
      .find({ user_id: userId })
      .project({ 'object_store.object_id': 1 })
      .toArray(),
    db.collection(`${SOURCE_OBJECT_BUCKET}.files`)
      .find({ 'metadata.user_id': userId })
      .project({ _id: 1 })
      .toArray(),
  ])
  const referencedObjectIds = new Set(
    versions.map((version) => String(version.object_store?.object_id ?? '')).filter(Boolean),
  )
  const orphanSourceObjects = storedFiles.filter(
    (file) => !referencedObjectIds.has(String(file._id)),
  ).length
  const passed = Object.values(orphanCounts).every((count) => count === 0)
    && orphanSourceObjects === 0
  return {
    passed,
    activeCourseCount: activeCourseIds.size,
    orphanCounts,
    orphanSourceObjects,
  }
}
