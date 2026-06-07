export type ActionIntent =
  | 'quiz_request'
  | 'next_topic'
  | 'prev_topic'
  | 'explain_again'
  | 'go_deeper'
  | 'simplify'
  | 'show_example'
  | 'go_to_topic'
  | 'custom_quiz'
  | 'generate_page'
  | 'skip_current'
  | 'change_lesson_style'

export type UIAction =
  | { action: 'open_quiz';           topicId: string }
  | { action: 'next_topic';          topicId: string; topicTitle: string }
  | { action: 'prev_topic';          topicId: string; topicTitle: string }
  | { action: 'navigate_to_topic';   topicId: string; topicTitle: string }
  | { action: 'regenerate_page';     approach: string }
  | { action: 'generate_custom_page'; instruction: string; targetPageNumber: number }

export interface AgentMessage {
  id: string
  content: string
  uiAction: UIAction | null
}
