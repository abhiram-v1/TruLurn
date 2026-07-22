import type { AIReasoningEffort } from '@/lib/ai/types'
import type { DoubtQuestionType } from './classifyQuestion.ts'

// Preserve the full reasoning path for questions where synthesis or formal work
// matters. Ordinary page clarifications use low effort: the current lesson,
// learner state, and examples are already supplied in the prompt, so extra hidden
// reasoning usually adds latency rather than useful teaching quality.
const COMPLEX_REASONING_SIGNAL =
  /\b(prove|proof|derive|derivation|debug|why does|why is|compare|contrast|trade-?off|edge case|counterexample|step by step|work through|calculate|solve|show that|explain why|connect|relationship|difference between)\b/i

export function resolveDoubtReasoningEffort(
  type: DoubtQuestionType,
  question: string,
): AIReasoningEffort {
  if (type === 'course_specific') return 'medium'
  if (question.length > 280 || COMPLEX_REASONING_SIGNAL.test(question)) return 'medium'
  return 'low'
}

