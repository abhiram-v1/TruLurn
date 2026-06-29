import type { Db } from 'mongodb'

export type AppKnowledgeEntry = {
  id: string
  title: string
  aliases: string[]
  summary: string
  details: string[]
  controls?: string[]
  related?: string[]
}

export type RetrievedAppKnowledge = AppKnowledgeEntry & {
  score: number
  matchedTerms: string[]
}

const STOP_WORDS = new Set([
  'a', 'about', 'and', 'app', 'are', 'can', 'does', 'for', 'how', 'i', 'in',
  'is', 'it', 'me', 'of', 'on', 'or', 'stuff', 'that', 'the', 'this', 'to',
  'trulurn', 'what', 'where', 'why', 'with', 'you',
])

function normalize(value: string) {
  return value.toLowerCase().normalize('NFKC').replace(/[^a-z0-9+#]+/g, ' ').trim()
}

function tokens(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

export const APP_KNOWLEDGE: AppKnowledgeEntry[] = [
  {
    id: 'product-overview',
    title: 'TruLurn',
    aliases: ['what is trulurn', 'how does this app work', 'app features', 'what can the app do'],
    summary: 'TruLurn is an adaptive learning workspace that builds courses, teaches through generated lesson pages, answers questions with course and learner context, measures understanding with quizzes, and schedules retrieval practice.',
    details: [
      'A course combines an Atlas for structure, lesson pages for teaching, an agent for explanation and actions, quizzes for assessed evidence, a graph for understanding relationships, recall breaks for in-session retrieval, and spaced reviews for long-term retention.',
      'The system separates factual course evidence from learner preferences and assessment-backed skill state. Personalization changes teaching and sequencing, not the factual evidence base.',
      'The main navigation contains Home, Atlas, Graph, Quizzes, and Settings.',
    ],
    related: ['atlas-traccia', 'agent-chat', 'knowledge-graph', 'quizzes-exams', 'recall-breaks'],
  },
  {
    id: 'agent-chat',
    title: 'Learning agent',
    aliases: ['agent', 'chat', 'assistant', 'doubt chat', 'ask question', 'lesson assistant'],
    summary: 'The agent is the primary conversational intelligence inside a lesson. It explains concepts, reasons through problems, uses the current course position and assessed learner state, and can execute clear lesson actions.',
    details: [
      'For explanations, it can use the current page, earlier course content, uploaded source evidence, learner questions, quiz results, misconceptions, preferences, and app product knowledge when relevant.',
      'It can also handle explicit actions such as opening a quiz, moving between topics, regenerating a page with a different approach, or generating a custom page.',
      'Assistant answers are not treated as factual evidence for later retrieval. Learner-authored questions may be retrieved to understand confusion, but not as proof.',
    ],
    related: ['lesson-pages', 'learner-memory', 'quizzes-exams', 'source-based-learning'],
  },
  {
    id: 'atlas-traccia',
    title: 'Atlas and Traccia',
    aliases: ['atlas', 'traccia', 'roadmap', 'mini roadmap', 'course map', 'locked topic', 'topic path'],
    summary: 'The Atlas is the course structure; Traccia is the active lesson path shown while studying.',
    details: [
      'The course Atlas shows branches and topics in their intended learning order. It is used for navigation and progression, not as a mastery graph.',
      'Inside a lesson, Traccia shows the current branch, recursive topic structure, current position, progress, locked or available topics, and tagged recall reminders.',
      'Topic access depends on the course progression mode and prerequisites. Structural container nodes organize the course but do not represent teachable lesson pages.',
    ],
    related: ['progression-modes', 'knowledge-graph', 'tagged-reminders', 'lesson-pages'],
  },
  {
    id: 'lesson-pages',
    title: 'Lesson pages',
    aliases: ['lesson page', 'page generation', 'simplify', 'go deeper', 'show example', 'custom page', 'regenerate page'],
    summary: 'Topics are taught through generated, stored lesson pages. Pages are planned around conceptual load and generated as the learner reaches them.',
    details: [
      'A page can be regenerated with another explanation, greater depth, simpler framing, or an example-focused approach. A custom instruction can generate an additional page.',
      'The lesson plan controls the normal page count so navigation cannot generate unlimited filler pages past the planned topic coverage.',
      'In source-based courses, covered topics require retrieved source evidence and citation verification before a page is stored.',
    ],
    related: ['agent-chat', 'teaching-personalization', 'source-based-learning'],
  },
  {
    id: 'recall-breaks',
    title: 'Recall breaks',
    aliases: [
      'recall', 'recall break', 'break', 'break reminder', 'protected break',
      'memory cues', 'recall prompt', 'adaptive break', '30 minute break',
    ],
    summary: 'Recall breaks are short pauses during an active study session that protect rest time and then ask the learner to retrieve recently studied ideas from memory.',
    details: [
      'They are minute-scale retrieval practice, distinct from day-scale spaced reviews. TruLurn tracks active study time, newly viewed pages, and concept load since the previous break.',
      'Adaptive mode waits until enough material and active time have accumulated, then tries to surface the suggestion at a natural interruption point. Fixed modes use 30- or 60-minute active-study intervals. Manual-only mode disables scheduled prompts.',
      'Starting a break pauses the lesson behind a countdown while recall prompts are prepared. On return, prompts can ask for recall, a connection, or an application. Nothing needs to be typed or graded.',
      'A break can be started, snoozed, or skipped. Break duration is configurable from 5 to 45 minutes. Tagged prompts are saved in Traccia for later review.',
      'Completing prompt-only recall records the activity but does not by itself raise assessed mastery; quiz evidence is required for mastery updates.',
    ],
    controls: [
      'Choose Adaptive, Every 30 min, Every 60 min, or Manual only during course setup or in Settings.',
      'Set break length in Settings. The default is 10 minutes.',
      'Use Tag when an idea does not return clearly; tagged prompts appear in Traccia.',
    ],
    related: ['tagged-reminders', 'spaced-reviews', 'learner-memory'],
  },
  {
    id: 'tagged-reminders',
    title: 'Tagged recall reminders',
    aliases: ['tag', 'tagged reminder', 'tagged recall', 'reminder in traccia', 'save prompt'],
    summary: 'A tagged reminder is a recall prompt the learner marks because the idea did not return clearly.',
    details: [
      'The saved reminder keeps the prompt, concept, source topic, and page location so the learner can return to the relevant lesson.',
      'Tagged reminders are listed in the Tagged view inside Traccia and can be removed after they are no longer useful.',
      'Tagging is a learner signal for later reinforcement; it is not treated as proof of mastery or failure.',
    ],
    related: ['recall-breaks', 'atlas-traccia'],
  },
  {
    id: 'spaced-reviews',
    title: 'Spaced reviews',
    aliases: ['review', 'reviews due', 'spaced repetition', 'due review', 'forgetting curve'],
    summary: 'Spaced reviews revisit passed topics over expanding day-scale intervals so one successful quiz does not become permanent mastery without later retrieval.',
    details: [
      'Reviews are scheduled after assessed success, generally across 1, 3, 7, 14, 30, 60, and 120-day intervals.',
      'Passing a review advances to a longer interval. Failing resets the cadence and can mark the topic unstable so it returns to active learning.',
      'This system is separate from recall breaks: recall breaks operate within a study session; spaced reviews operate between sessions over days or months.',
    ],
    related: ['recall-breaks', 'quizzes-exams', 'knowledge-graph'],
  },
  {
    id: 'quizzes-exams',
    title: 'Quizzes and exams',
    aliases: ['quiz', 'exam', 'test', 'assessment', 'score', 'retake', 'mastery evidence'],
    summary: 'Quizzes are the primary assessed evidence of understanding. The exam engine adapts questions using the course graph, prior answers, concept importance, and diagnosed gaps.',
    details: [
      'Questions are generated and evaluated one at a time so later questions can adapt to earlier performance. The engine controls concept selection, phase, difficulty, and termination; the model writes and evaluates the question.',
      'Results update topic learning signals, skill state, misconceptions, prerequisite gaps, and review scheduling. Reading pages or completing ungraded recall prompts does not substitute for assessed evidence.',
      'A topic exam can move through warmup, breadth, depth, and verification. Failed concepts may be revisited from another angle before recovery is accepted.',
    ],
    related: ['knowledge-graph', 'spaced-reviews', 'learner-memory'],
  },
  {
    id: 'knowledge-graph',
    title: 'Knowledge graph',
    aliases: ['graph', 'knowledge graph', 'node', 'edge', 'connection', 'learning signal', 'priority path'],
    summary: 'The Graph is a reflection view of concepts, dependencies, recommendations, semantic relationships, learner-created links, and current learning signals.',
    details: [
      'It differs from the Atlas: the Atlas organizes the learning path, while the Graph shows how concepts relate and where understanding is strong, developing, unstable, active, or locked.',
      'Filters can show locked topics, branch regions, priority paths, recommended links, semantic links, all connections, or a focused subset.',
      'Learners can add their own concept connections. Graph state is informed by lessons, quiz evidence, recall performance, freshness, and stored relationships.',
    ],
    related: ['atlas-traccia', 'quizzes-exams', 'spaced-reviews'],
  },
  {
    id: 'learner-memory',
    title: 'Learner memory',
    aliases: ['memory', 'what do you remember', 'learner profile', 'personalization memory', 'forget memory', 'misconception'],
    summary: 'Learner memory stores preferences, profile facts, concept-level knowledge state, evidence freshness, and active misconceptions for personalization.',
    details: [
      'Explicit learner statements outrank course settings, validated assessment, repeated behavior, and single inferences. Conflicts preserve history instead of silently overwriting it.',
      'Concept states distinguish never encountered, recognizes, understands, can apply, can transfer, and forgetting. Page views, chat, feedback, recall prompts, and assessed answers remain distinct evidence types.',
      'Only repeated evaluated evidence can establish understanding, application, or transfer. Unassessed activity establishes familiarity at most, and assessed knowledge becomes forgetting when it grows stale.',
      'Memory changes presentation, difficulty, pacing, and sequencing. It is never used as factual evidence about the course subject.',
    ],
    controls: [
      'Open Settings, then Learner memory, to review preferences, concept states, evidence counts, freshness, and source.',
      'Use Correct to replace a memory explicitly or Forget to delete it and suppress lower-authority recreation.',
      'Use the concept-state selector to correct a knowledge assumption. The correction is marked as learner-stated rather than assessment-proven.',
    ],
    related: ['teaching-personalization', 'quizzes-exams', 'recall-breaks'],
  },
  {
    id: 'source-based-learning',
    title: 'Source-Based Learning',
    aliases: ['source based', 'source grounded', 'upload documents', 'uploaded notes', 'citations', 'sources', 'pdf'],
    summary: 'Source-Based Learning builds the course from uploaded documents or notes and requires source-grounded generation for covered material.',
    details: [
      'Files are stored, parsed into structured blocks and passages, embedded, and attached to the generated course with source and version provenance.',
      'Lesson pages and source-grounded answers retrieve relevant passages. Factual claims require citations and pass through claim-evidence verification and repair.',
      'If no relevant evidence is available, the system abstains rather than filling the gap from unrelated material. Topics explicitly marked as inferred may use general knowledge to complete necessary foundations.',
    ],
    related: ['ai-teacher-mode', 'lesson-pages', 'agent-chat'],
  },
  {
    id: 'ai-teacher-mode',
    title: 'AI as Teacher',
    aliases: ['ai teacher', 'model knowledge', 'course source mode', 'no upload'],
    summary: 'AI as Teacher starts from a topic and learning goal, researches the subject, and builds a curriculum without requiring uploaded material.',
    details: [
      'It is suited to learning a subject end to end. Lesson generation can use model knowledge and lesson research rather than being restricted to user-provided sources.',
      'The rest of the experience still applies: Atlas structure, lesson pages, contextual agent answers, quizzes, learner memory, graph signals, recall breaks, and spaced reviews.',
    ],
    related: ['source-based-learning', 'course-setup'],
  },
  {
    id: 'course-setup',
    title: 'Course setup',
    aliases: ['setup', 'create course', 'course options', 'knowledge level', 'learning purpose', 'course depth', 'teaching style'],
    summary: 'Course setup defines the source mode, progression policy, depth, learner knowledge level, learning purpose, and recall-break preference.',
    details: [
      'Depth controls overall coverage: Overview focuses on core concepts, Standard balances coverage and examples, and Mastery adds deeper reasoning and edge cases.',
      'Knowledge level changes assumptions and framing: Beginner builds intuition first, Intermediate skips basics and emphasizes connections, and Expert prioritizes formal models, derivations, tradeoffs, and research context.',
      'Purpose emphasizes exploration, practical application, or rigorous research. Lessons use one shared warm, direct teaching style.',
    ],
    related: ['progression-modes', 'teaching-personalization', 'recall-breaks'],
  },
  {
    id: 'progression-modes',
    title: 'Progression modes',
    aliases: ['guided', 'balanced', 'open mode', 'progression', 'unlock', 'skip topic', 'jump ahead'],
    summary: 'Progression mode controls how strictly the course enforces topic order and evidence before moving forward.',
    details: [
      'Guided mode opens progress through completed lessons and quiz evidence and is appropriate for new or high-stakes subjects.',
      'Balanced mode keeps the planned structure but can trim basics once understanding is demonstrated.',
      'Open mode allows free topic jumps while the Atlas preserves what was skipped.',
    ],
    related: ['atlas-traccia', 'course-setup', 'quizzes-exams'],
  },
  {
    id: 'teaching-personalization',
    title: 'Teaching personalization',
    aliases: ['teaching style', 'personalization', 'lesson behavior', 'explanation approach'],
    summary: 'Lessons use one restrained professor-like teaching style, calibrated by learner level, purpose, audience, source coverage, and assessed needs.',
    details: [
      'The lesson begins directly inside the concept without greetings, classroom role-play, praise, or theatrical questions.',
      'It preserves formal definitions and field terminology while adding intuition, mechanism, a concrete example, and an important limitation when relevant.',
      'Personalization may use learner audience, knowledge level, skill state, misconceptions, and lesson feedback as evidence without changing the factual evidence base.',
      'Existing pages remain unchanged until regenerated; new and regenerated pages use the shared teaching style.',
    ],
    related: ['learner-memory', 'course-setup', 'agent-chat'],
  },
  {
    id: 'settings',
    title: 'Settings',
    aliases: ['settings', 'dark mode', 'appearance', 'configure recall', 'product settings'],
    summary: 'Settings contains appearance controls and learning controls such as recall-break timing, break duration, and learner-memory review.',
    details: [
      'Dark mode is stored on the current device. Recall settings and durable learner memory require an authenticated account.',
      'Learner memory can be inspected, corrected, or forgotten from Settings.',
    ],
    related: ['recall-breaks', 'learner-memory'],
  },
  {
    id: 'course-deletion',
    title: 'Course deletion',
    aliases: ['delete course', 'remove course', 'erase course', 'course data deletion'],
    summary: 'Deleting a course permanently removes its learning and source lineage rather than only hiding it from the home screen.',
    details: [
      'The cascade includes the Atlas, topics, lesson pages, summaries, doubts, quizzes, learning events, review schedules, recall sessions, learner state, source documents, parsed passages, retrieval traces, and stored source originals.',
      'A post-delete validation checks that no course-scoped records or source objects remain.',
    ],
  },
]

const STRONG_PRODUCT_MARKERS = [
  'trulurn', 'this app', 'the app', 'in app', 'app feature', 'product feature',
  'setting', 'screen', 'button', 'panel', 'toolbar', 'atlas', 'traccia', 'roadmap',
  'knowledge graph', 'recall break', 'protected break', 'tagged reminder',
  'spaced review', 'reviews due', 'learner memory', 'source based', 'ai teacher',
  'lesson page', 'dark mode', 'progression mode', 'course setup', 'delete course',
]

const AMBIGUOUS_PRODUCT_MARKERS = [
  'graph', 'quiz', 'exam', 'recall', 'break', 'review', 'memory', 'progression',
  'guided', 'balanced', 'open mode',
]

export function shouldRetrieveAppKnowledge(query: string) {
  const normalized = normalize(query)
  if (!normalized) return false
  if (STRONG_PRODUCT_MARKERS.some((marker) => normalized.includes(marker))) return true

  const hasProductFraming = /\b(app|feature|setting|screen|button|panel|toolbar|trulurn|this|that|these|those)\b/.test(normalized)
  return hasProductFraming
    && AMBIGUOUS_PRODUCT_MARKERS.some((marker) => normalized.includes(marker))
}

export function retrieveAppKnowledge(query: string, limit = 4): RetrievedAppKnowledge[] {
  const normalizedQuery = normalize(query)
  const queryTokens = new Set(tokens(query))
  const broadProductQuestion = /\b(what is trulurn|how does this app work|what can (?:this|the) app do|app features)\b/.test(normalizedQuery)

  return APP_KNOWLEDGE.map((entry) => {
    const title = normalize(entry.title)
    const aliases = entry.aliases.map(normalize)
    const entryTokens = new Set(tokens([
      entry.title,
      ...entry.aliases,
      entry.summary,
      ...entry.details,
      ...(entry.controls ?? []),
    ].join(' ')))
    const matchedTerms = [...queryTokens].filter((token) => entryTokens.has(token))
    let score = matchedTerms.length * 2

    if (normalizedQuery.includes(title) && title.length > 2) score += 10
    for (const alias of aliases) {
      if (alias.length > 2 && normalizedQuery.includes(alias)) {
        score += alias.includes(' ') ? 9 : 6
        matchedTerms.push(alias)
      }
    }
    if (broadProductQuestion && entry.id === 'product-overview') score += 20
    if (entry.id === 'product-overview' && normalizedQuery === 'app') score += 10

    return {
      ...entry,
      score,
      matchedTerms: [...new Set(matchedTerms)],
    }
  })
    .filter((entry) => entry.score >= 2)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, Math.max(1, limit))
}

async function liveProductState(
  db: Db,
  userId: string,
  courseId: string,
  entries: RetrievedAppKnowledge[],
) {
  const ids = new Set(entries.map((entry) => entry.id))
  const lines: string[] = []

  if (ids.has('recall-breaks') || ids.has('settings')) {
    const [settings, session] = await Promise.all([
      db.collection('userSettings').findOne(
        { _id: userId as any },
        { projection: { recall_break_mode: 1, recall_break_duration_minutes: 1 } },
      ),
      db.collection('studySessions').findOne(
        { user_id: userId, course_id: courseId, status: 'active' },
        {
          projection: {
            active_ms: 1,
            active_ms_at_last_break: 1,
            pages: 1,
            pages_at_last_break: 1,
            breaks_completed: 1,
            snoozed_until: 1,
          },
        },
      ),
    ])
    const mode = String(settings?.recall_break_mode ?? 'auto')
    const duration = Math.min(
      45,
      Math.max(5, Math.round(Number(settings?.recall_break_duration_minutes ?? 10))),
    )
    lines.push(`Current recall setting: ${mode}; protected break length: ${duration} minutes.`)
    if (session) {
      const minutesSinceBreak = Math.max(
        0,
        Math.round((Number(session.active_ms ?? 0) - Number(session.active_ms_at_last_break ?? 0)) / 60_000),
      )
      const pages = Array.isArray(session.pages) ? session.pages.length : 0
      const pagesSinceBreak = Math.max(0, pages - Number(session.pages_at_last_break ?? 0))
      const snoozedUntil = session.snoozed_until
        ? `; snoozed until ${new Date(session.snoozed_until).toISOString()}`
        : ''
      lines.push(
        `Active study session: ${minutesSinceBreak} active minutes and ${pagesSinceBreak} new pages since the last break; ${Number(session.breaks_completed ?? 0)} breaks completed${snoozedUntil}.`,
      )
    }
  }

  if (ids.has('spaced-reviews')) {
    const due = await db.collection('reviewSchedule').countDocuments({
      user_id: userId,
      course_id: courseId,
      status: 'scheduled',
      due_at: { $lte: new Date() },
    })
    lines.push(`Reviews currently due in this course: ${due}.`)
  }

  if (ids.has('tagged-reminders')) {
    const tagged = await db.collection('taggedReminders').countDocuments({
      user_id: userId,
      course_id: courseId,
    })
    lines.push(`Tagged recall reminders currently saved in this course: ${tagged}.`)
  }

  if (ids.has('learner-memory')) {
    const [memories, skills, misconceptions] = await Promise.all([
      db.collection('learnerMemories').countDocuments({
        user_id: userId,
        $or: [{ course_id: courseId }, { course_id: null }],
        status: 'active',
      }),
      db.collection('learnerSkillStates').countDocuments({ user_id: userId, course_id: courseId }),
      db.collection('learnerMisconceptionStates').countDocuments({
        user_id: userId,
        course_id: courseId,
        status: 'active',
      }),
    ])
    lines.push(
      `Current learner model for this course: ${memories} active memories/preferences, ${skills} assessed skills, ${misconceptions} active misconceptions.`,
    )
  }

  if (
    ids.has('course-setup')
    || ids.has('progression-modes')
    || ids.has('teaching-personalization')
    || ids.has('source-based-learning')
    || ids.has('ai-teacher-mode')
  ) {
    const course = await db.collection('courses').findOne(
      { _id: courseId as any, user_id: userId },
      {
        projection: {
          mode: 1,
          learning_control: 1,
          course_depth: 1,
          knowledge_level: 1,
          learning_purpose: 1,
          teaching_persona: 1,
        },
      },
    )
    if (course) {
      lines.push([
        'Current course configuration:',
        `mode=${course.mode ?? 'ai_teacher'}`,
        `progression=${course.learning_control ?? 'balanced'}`,
        `depth=${course.course_depth ?? 'standard'}`,
        `knowledge level=${course.knowledge_level ?? 'beginner'}`,
        `purpose=${course.learning_purpose ?? 'practitioner'}`,
        'teaching style=warm, direct, and academically precise',
      ].join('; '))
    }
  }

  return lines
}

export async function buildAppKnowledgeContext({
  db,
  userId,
  courseId,
  query,
}: {
  db: Db
  userId: string
  courseId: string
  query: string
}) {
  const entries = retrieveAppKnowledge(query)
  if (!entries.length) return ''
  const liveState = await liveProductState(db, userId, courseId, entries)

  const blocks = entries.map((entry) => [
    `## ${entry.title}`,
    entry.summary,
    ...entry.details.map((detail) => `- ${detail}`),
    ...(entry.controls?.length
      ? ['Controls:', ...entry.controls.map((control) => `- ${control}`)]
      : []),
    ...(entry.related?.length ? [`Related feature IDs: ${entry.related.join(', ')}`] : []),
  ].join('\n'))

  return [
    'PRODUCT KNOWLEDGE CONTEXT:',
    'This is trusted, implementation-aligned knowledge about TruLurn itself. Use it to explain the product directly. Do not confuse it with course-subject evidence or learner memory.',
    ...blocks,
    ...(liveState.length ? ['LIVE USER/COURSE STATE:', ...liveState] : []),
  ].join('\n\n')
}
