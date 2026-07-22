import type { QuestionType } from '@/types'

export type QuizQuestionDraft = {
  type: QuestionType
  question: string
  options: string[] | null
  correct_answer: string | null
  answer_explanation: string | null
  rubric: string | null
}

export type QuizQuestionQualityIssue = {
  code: string
  message: string
}

function comparable(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^[a-d][.)]\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenSimilarity(a: string, b: string) {
  const left = new Set(comparable(a).split(/\s+/).filter((token) => token.length > 2))
  const right = new Set(comparable(b).split(/\s+/).filter((token) => token.length > 2))
  if (!left.size || !right.size) return 0
  const overlap = [...left].filter((token) => right.has(token)).length
  return overlap / Math.max(left.size, right.size)
}

export function validateQuizQuestion(
  draft: QuizQuestionDraft,
  previousQuestions: string[] = [],
): QuizQuestionQualityIssue[] {
  const issues: QuizQuestionQualityIssue[] = []
  const question = String(draft.question ?? '').trim()
  const rubric = String(draft.rubric ?? '').trim()
  const explanation = String(draft.answer_explanation ?? '').trim()

  if (question.length < 24) {
    issues.push({ code: 'question_too_short', message: 'The question is too short to establish a specific, answerable task.' })
  }
  if (/\b(correct answer is|answer:\s*[a-d]|obviously|clearly the answer)\b/i.test(question)) {
    issues.push({ code: 'answer_leakage', message: 'The question appears to reveal or strongly signal its answer.' })
  }
  if (previousQuestions.some((previous) => tokenSimilarity(question, previous) >= 0.72)) {
    issues.push({ code: 'duplicate_question', message: 'The question substantially duplicates an earlier question in this session.' })
  }
  if (rubric.length < 24) {
    issues.push({ code: 'weak_rubric', message: 'The grading rubric must describe the reasoning or behavior that demonstrates understanding.' })
  }

  if (draft.type === 'mcq') {
    const options = draft.options ?? []
    if (options.length !== 4) {
      issues.push({ code: 'mcq_option_count', message: 'An MCQ must have exactly four options.' })
    }
    const normalizedOptions = options.map(comparable)
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      issues.push({ code: 'duplicate_options', message: 'MCQ options must be meaningfully distinct.' })
    }
    if (options.some((option) => /\b(all|none) of the above\b/i.test(option))) {
      issues.push({ code: 'banned_option', message: 'MCQs cannot use all-of-the-above or none-of-the-above shortcuts.' })
    }
    const correct = comparable(draft.correct_answer)
    if (!correct || !normalizedOptions.includes(correct)) {
      issues.push({ code: 'missing_correct_option', message: 'The correct answer must exactly identify one of the four options.' })
    }
    if (/^(what|which) (is|term|word)\b/i.test(question)) {
      issues.push({ code: 'definition_lookup', message: 'MCQs must test reasoning or application, not a vocabulary lookup.' })
    }
    if (explanation.length < 28) {
      issues.push({ code: 'missing_answer_explanation', message: 'An MCQ needs a short explanation of why the answer is correct.' })
    }
  } else if (draft.type === 'true_false') {
    if (draft.options?.length) {
      issues.push({ code: 'true_false_options', message: 'True/false questions must not include MCQ options.' })
    }
    if (!['true', 'false'].includes(comparable(draft.correct_answer))) {
      issues.push({ code: 'invalid_true_false_answer', message: 'A true/false question must store true or false as its correct answer.' })
    }
    if (explanation.length < 28) {
      issues.push({ code: 'missing_answer_explanation', message: 'A true/false question needs a short explanation of why the statement holds or fails.' })
    }
  } else {
    if (draft.options?.length) {
      issues.push({ code: 'unexpected_options', message: 'Open-response questions must not include answer options.' })
    }
    if (draft.correct_answer != null) {
      issues.push({ code: 'unexpected_correct_answer', message: 'Open-response questions should be evaluated against their rubric, not an exact answer string.' })
    }
  }

  return issues
}
