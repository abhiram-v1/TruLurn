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

export type QuestionType = 'apply' | 'spot_error' | 'explain'

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
  section: string
  pages?: Page[]
  children?: Topic[]
}

export interface Page {
  id: string
  topic_id: string
  page_number: number
  content: string
  created_at: string
}

export interface DoubtMessage {
  id: string
  topic_id: string
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
