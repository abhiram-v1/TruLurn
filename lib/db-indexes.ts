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
    db.collection('branches').createIndex(
      { course_id: 1, created_at: 1 },
      { background: true, name: 'branches_course_order' },
    ),
    db.collection('topics').createIndex(
      { course_id: 1, branch_id: 1, sequence_index: 1, position: 1 },
      { background: true, name: 'topics_branch_order' },
    ),
    db.collection('topics').createIndex(
      { course_id: 1, branch_position: 1, branch_id: 1, sequence_index: 1, position: 1 },
      { background: true, name: 'topics_course_order' },
    ),
    db.collection('curricula').createIndex(
      { course_id: 1 },
      { background: true, name: 'curricula_course' },
    ),
    // Research evidence lookup by generated course
    db.collection('courseResearchReports').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'course_research_user_course' },
    ),
    db.collection('lessonResearchCache').createIndex(
      { expires_at: 1 },
      { background: true, expireAfterSeconds: 0, name: 'lesson_research_cache_ttl' },
    ),
    db.collection('aiUsageEvents').createIndex(
      { created_at: 1 },
      { background: true, expireAfterSeconds: 60 * 60 * 24 * 90, name: 'ai_usage_events_ttl' },
    ),
    db.collection('aiUsageEvents').createIndex(
      { feature: 1, provider: 1, model: 1, created_at: -1 },
      { background: true, name: 'ai_usage_events_feature' },
    ),
    db.collection('lessonResearchCache').createIndex(
      { user_id: 1, course_id: 1, topic_id: 1, page_number: 1, updated_at: -1 },
      { background: true, name: 'lesson_research_cache_scope' },
    ),
    // Spaced repetition: due-review lookup (getDueReviews / countDueReviews)
    db.collection('reviewSchedule').createIndex(
      { user_id: 1, status: 1, due_at: 1 },
      { background: true, name: 'review_schedule_due' },
    ),
    // Spaced repetition: one schedule per (user, course, topic)
    db.collection('reviewSchedule').createIndex(
      { user_id: 1, course_id: 1, topic_id: 1 },
      { background: true, unique: true, name: 'review_schedule_unique' },
    ),
    // Lesson micro-feedback: one signal per (user, course, topic, page)
    db.collection('lessonFeedback').createIndex(
      { user_id: 1, course_id: 1, topic_id: 1, page_number: 1 },
      { background: true, unique: true, name: 'lesson_feedback_unique' },
    ),
    // Failed-turn lookup for doubt-chat wrong-answer context
    db.collection('examTurns').createIndex(
      { session_id: 1, 'evaluation.passed': 1 },
      { background: true, name: 'exam_turns_session_eval' },
    ),
    // Recall breaks: active study-session lookup per (user, course)
    db.collection('studySessions').createIndex(
      { user_id: 1, course_id: 1, status: 1, last_activity_at: -1 },
      { background: true, name: 'study_sessions_active' },
    ),
    // Recall breaks: open recall-session lookup + per-course history
    db.collection('recallSessions').createIndex(
      { user_id: 1, study_session_id: 1, status: 1 },
      { background: true, name: 'recall_sessions_open' },
    ),
    db.collection('recallSessions').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'recall_sessions_course' },
    ),
    // Recall prompts explicitly tagged for later reinforcement.
    db.collection('taggedReminders').createIndex(
      { user_id: 1, course_id: 1, tagged_at: -1 },
      { background: true, name: 'tagged_reminders_course' },
    ),
    db.collection('taggedReminders').createIndex(
      { user_id: 1, course_id: 1, recall_session_id: 1, recall_item_id: 1 },
      { background: true, unique: true, name: 'tagged_reminders_unique' },
    ),
    // Personalization: one cached learner profile per (user, course)
    db.collection('learnerProfiles').createIndex(
      { user_id: 1, course_id: 1 },
      { background: true, unique: true, name: 'learner_profiles_unique' },
    ),
    // Memory V2: active typed records, immutable history, and one state per skill.
    db.collection('learnerMemories').createIndex(
      { user_id: 1, course_id: 1, status: 1, kind: 1, updated_at: -1 },
      { background: true, name: 'learner_memories_active_scope' },
    ),
    db.collection('learnerMemories').createIndex(
      { user_id: 1, course_id: 1, kind: 1, key: 1, status: 1 },
      { background: true, name: 'learner_memories_key_history' },
    ),
    db.collection('learnerSkillStates').createIndex(
      { user_id: 1, course_id: 1, skill_key: 1 },
      { background: true, unique: true, name: 'learner_skill_states_unique' },
    ),
    db.collection('learnerConceptStates').createIndex(
      { user_id: 1, course_id: 1, concept_key: 1 },
      { background: true, unique: true, name: 'learner_concept_states_unique' },
    ),
    db.collection('learnerConceptStates').createIndex(
      { user_id: 1, course_id: 1, topic_id: 1, stage: 1, updated_at: -1 },
      { background: true, name: 'learner_concept_states_topic' },
    ),
    db.collection('learnerMisconceptionStates').createIndex(
      { user_id: 1, course_id: 1, misconception_key: 1 },
      { background: true, unique: true, name: 'learner_misconception_states_unique' },
    ),
    db.collection('learnerMemorySyncStates').createIndex(
      { user_id: 1, course_id: 1 },
      { background: true, unique: true, name: 'learner_memory_sync_unique' },
    ),
    // Source indexing readiness and versioned re-embedding scans.
    db.collection('sourceChunks').createIndex(
      { user_id: 1, course_id: 1, embedding_version: 1, embedding_status: 1 },
      { background: true, name: 'source_chunks_embedding_readiness' },
    ),
    // Only learner-authored questions are eligible for semantic doubt retrieval.
    db.collection('doubtMessages').createIndex(
      { user_id: 1, course_id: 1, role: 1, embedding_version: 1, created_at: -1 },
      { background: true, name: 'doubt_messages_retrieval_eligible' },
    ),
    db.collection('doubtMessages').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'doubt_messages_chat_history' },
    ),
    db.collection('doubtMessages').createIndex(
      { user_id: 1, course_id: 1, role: 1, created_at: -1 },
      { background: true, name: 'doubt_messages_latest_role' },
    ),
    // Retrieval traces support incident diagnosis, evaluation, and cost attribution.
    db.collection('retrievalTraces').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'retrieval_traces_user_course' },
    ),
    db.collection('retrievalTraces').createIndex(
      { created_at: 1 },
      { background: true, expireAfterSeconds: 60 * 60 * 24 * 30, name: 'retrieval_traces_ttl' },
    ),
    // Phase 5 cutover: one release policy and one resumable migration per user/version.
    db.collection('ragCutoverConfigs').createIndex(
      { user_id: 1 },
      { background: true, unique: true, name: 'rag_cutover_user' },
    ),
    db.collection('ragMigrationJobs').createIndex(
      { user_id: 1, embedding_version: 1 },
      { background: true, unique: true, name: 'rag_migration_user_version' },
    ),
    db.collection('ragMigrationJobs').createIndex(
      { status: 1, lease_expires_at: 1, updated_at: 1 },
      { background: true, name: 'rag_migration_queue' },
    ),
    db.collection('ragCleanupRuns').createIndex(
      { user_id: 1, created_at: -1 },
      { background: true, name: 'rag_cleanup_user_history' },
    ),
    db.collection('deletionValidationRuns').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'deletion_validation_user_course' },
    ),
    // Durable source ingestion registry and retry queue.
    db.collection('sourceDocuments').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'source_documents_user_course' },
    ),
    db.collection('sourceDocuments').createIndex(
      { user_id: 1, generation_job_id: 1, current_version_id: 1 },
      { background: true, unique: true, name: 'source_documents_generation_version' },
    ),
    db.collection('sourceDocumentVersions').createIndex(
      { user_id: 1, source_document_id: 1, version_number: 1 },
      { background: true, unique: true, name: 'source_versions_document_version' },
    ),
    db.collection('sourceIngestionJobs').createIndex(
      { status: 1, lease_expires_at: 1, updated_at: 1 },
      { background: true, name: 'source_ingestion_jobs_queue' },
    ),
    db.collection('sourceBlocks').createIndex(
      { source_version_id: 1, ordinal: 1 },
      { background: true, unique: true, name: 'source_blocks_version_order' },
    ),
    db.collection('sourcePassages').createIndex(
      { source_version_id: 1, ordinal: 1 },
      { background: true, unique: true, name: 'source_passages_version_order' },
    ),
    db.collection('sourcePassages').createIndex(
      { user_id: 1, course_id: 1, embedding_version: 1, embedding_status: 1 },
      { background: true, name: 'source_passages_embedding_readiness' },
    ),
    // App-owned subject guidance packs referenced by courses.
    db.collection('courseSkillPacks').createIndex(
      { key: 1 },
      { background: true, unique: true, name: 'course_skill_packs_key' },
    ),
    // User-created knowledge connections (personal graph edges)
    db.collection('userConnections').createIndex(
      { user_id: 1, course_id: 1 },
      { background: true, name: 'user_connections_course' },
    ),
    db.collection('userConnections').createIndex(
      { user_id: 1, course_id: 1, from_topic_id: 1, to_topic_id: 1 },
      { background: true, unique: true, name: 'user_connections_unique' },
    ),
    // Source-extracted images: retrieval/listing by course + version cleanup.
    db.collection('sourceImages').createIndex(
      { user_id: 1, course_id: 1, source_index: 1, page: 1, order: 1 },
      { background: true, name: 'source_images_course_order' },
    ),
    db.collection('sourceImages').createIndex(
      { source_version_id: 1 },
      { background: true, name: 'source_images_version' },
    ),
    // Graph manager: per-node confidence/review state (one per user+course+topic).
    db.collection('graphNodeMeta').createIndex(
      { user_id: 1, course_id: 1, topic_id: 1 },
      { background: true, unique: true, name: 'graph_node_meta_unique' },
    ),
    // Graph manager: per-edge relationship scores (one per labeled pair).
    db.collection('graphEdgeScores').createIndex(
      { user_id: 1, course_id: 1, from_label: 1, to_label: 1 },
      { background: true, unique: true, name: 'graph_edge_scores_unique' },
    ),
    // Graph manager: interaction audit trail.
    db.collection('graphInteractionLog').createIndex(
      { user_id: 1, course_id: 1, created_at: -1 },
      { background: true, name: 'graph_interaction_log_scope' },
    ),
  ])
}
