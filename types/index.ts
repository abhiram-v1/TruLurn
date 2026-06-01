export type CourseMode = 'ai_teacher' | 'source_grounded'

export type TopicState =
  | 'locked'
  | 'active'
  | 'done'
  | 'unstable'
  | 'partial'
  | 'functional'
  | 'mastered'

export type UnderstandingLevel = 1 | 2 | 3 | 4 | 5

export type QuestionType = 'apply' | 'spot_error' | 'explain' | 'mcq' | 'true_false' | 'code'

export interface Course {
  id: string
  user_id: string
  title: string
  topic: string
  goals: string | null
  mode: CourseMode
  created_at: string
}

export interface Topic {
  id: string
  course_id: string
  title: string
  parent_id: string | null
  position: number
  state: TopicState
  understanding_level: UnderstandingLevel | null
  prerequisites: string[]
  created_at: string
  branch_id: string
  section: string
  pages?: Page[]
  children?: Topic[]
}

export type BranchState = 'not_started' | 'in_progress' | 'mastered'

export interface Branch {
  id: string
  course_id: string
  title: string
  description: string
  state: BranchState
  active_topic_id: string
  topic_count: number
  mastered_count: number
}

// ── Structured lesson sections ────────────────────────────────────────────

export type LessonSectionType =
  | 'core'           // Main explanation — always present
  | 'prerequisites'  // Quick prerequisite recap
  | 'key_ideas'      // Bullet list of must-remember points
  | 'misconceptions' // Common wrong beliefs + corrections
  | 'examples'       // Concrete examples / analogies
  | 'checkpoints'    // Think-through questions (no text input)

export type TopicDepth = 'shallow' | 'medium' | 'deep'

export type ConceptKind =
  | 'definition'   // naming / orientation
  | 'mechanism'    // causal explanation
  | 'procedure'    // steps / algorithm / method
  | 'math'         // formula / derivation / quantitative
  | 'comparison'   // contrasts multiple ideas
  | 'pitfall'      // concept is commonly misunderstood

export interface LessonSection {
  type: LessonSectionType
  title?: string   // optional override label
  content: string  // raw markdown with LaTeX
}

// ── Page ──────────────────────────────────────────────────────────────────

export interface Page {
  id: string
  topic_id: string
  page_number: number
  content: string       // flat markdown — kept for search / backward compat
  created_at: string
  topic_depth?: TopicDepth
  concept_kind?: ConceptKind
  sections?: LessonSection[]
}

export interface DoubtMessage {
  id: string
  topic_id: string
  topic_title?: string | null
  page_number: number | null
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface QuizQuestion {
  id: string
  topic_id: string
  type: QuestionType
  question: string
  options?: string[] | null   // MCQ only — correct_answer is NOT sent to client
  rubric: string | null
  created_at: string
}

export interface QuizAttempt {
  id: string
  topic_id: string
  user_id: string
  questions_asked: string[]
  answers: Record<string, string>
  evaluation: Record<string, EvaluationResult>
  overall_level: UnderstandingLevel | null
  passed: boolean
  created_at: string
}

export interface EvaluationResult {
  level: UnderstandingLevel
  passed: boolean
  feedback: string
  gap: string | null
  false_confidence: boolean
}
