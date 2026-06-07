import type { Db } from 'mongodb'

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // Session resume lookup: course+topic+user+mode+status
    db.collection('examSessions').createIndex(
      { user_id: 1, course_id: 1, topic_id: 1, mode: 1, status: 1 },
      { background: true, name: 'exam_sessions_resume' },
    ),
    // Session list by user+course
    db.collection('examSessions').createIndex(
      { user_id: 1, course_id: 1, updated_at: -1 },
      { background: true, name: 'exam_sessions_user_course' },
    ),
    // Turn ordering within a session (getSessionTurns)
    db.collection('examTurns').createIndex(
      { session_id: 1, turn_index: 1 },
      { background: true, name: 'exam_turns_session_order' },
    ),
    // Queued/shown turn lookup + ordering
    db.collection('examTurns').createIndex(
      { session_id: 1, status: 1, turn_index: 1 },
      { background: true, name: 'exam_turns_session_status' },
    ),
    // Unanswered shown turn (getExamState)
    db.collection('examTurns').createIndex(
      { session_id: 1, user_id: 1, status: 1 },
      { background: true, name: 'exam_turns_session_user_status' },
    ),
    // Prior quiz evidence (buildBlueprint)
    db.collection('quizAttempts').createIndex(
      { user_id: 1, course_id: 1, topic_id: 1, created_at: -1 },
      { background: true, name: 'quiz_attempts_user_topic' },
    ),
    // Page lookup by topic (buildBlueprint, page generation)
    db.collection('pages').createIndex(
      { course_id: 1, topic_id: 1, page_number: 1 },
      { background: true, name: 'pages_course_topic_page' },
    ),
    // Page summary lookup by topic (buildBlueprint)
    db.collection('pageSummaries').createIndex(
      { course_id: 1, topic_id: 1, page_number: 1 },
      { background: true, name: 'page_summaries_course_topic' },
    ),
    // Topic list filtered by course + state
    db.collection('topics').createIndex(
      { course_id: 1, state: 1 },
      { background: true, name: 'topics_course_state' },
    ),
    // Research evidence lookup by generated course
    db.collection('courseResearchReports').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'course_research_user_course' },
    ),
  ])
}
