import type {
  Course,
  DoubtMessage,
  EvaluationResult,
  Page,
  QuizQuestion,
  Topic,
  UnderstandingLevel,
} from '@/types'

export const mockCourse: Course = {
  id: 'course-ml',
  user_id: 'local-user',
  title: 'Machine Learning Foundations',
  topic: 'Machine Learning',
  goals: 'Understand core ML ideas deeply enough to explain them, apply them, and avoid shallow memorization.',
  mode: 'ai_teacher',
  created_at: '2026-05-19T00:00:00.000Z',
}

export const mockTopics: Topic[] = [
  {
    id: 'linear-regression',
    course_id: mockCourse.id,
    title: 'Linear Regression',
    parent_id: null,
    position: 1,
    state: 'active',
    understanding_level: null,
    prerequisites: [],
    created_at: mockCourse.created_at,
    section: 'Supervised Learning',
  },
  {
    id: 'cost-functions',
    course_id: mockCourse.id,
    title: 'Cost Functions',
    parent_id: null,
    position: 2,
    state: 'partial',
    understanding_level: 2,
    prerequisites: ['linear-regression'],
    created_at: mockCourse.created_at,
    section: 'Supervised Learning',
  },
  {
    id: 'gradient-descent',
    course_id: mockCourse.id,
    title: 'Gradient Descent',
    parent_id: null,
    position: 3,
    state: 'locked',
    understanding_level: null,
    prerequisites: ['cost-functions'],
    created_at: mockCourse.created_at,
    section: 'Optimization',
  },
  {
    id: 'overfitting',
    course_id: mockCourse.id,
    title: 'Overfitting',
    parent_id: null,
    position: 4,
    state: 'unstable',
    understanding_level: 2,
    prerequisites: ['linear-regression'],
    created_at: mockCourse.created_at,
    section: 'Model Behavior',
  },
  {
    id: 'regularization',
    course_id: mockCourse.id,
    title: 'Regularization',
    parent_id: null,
    position: 5,
    state: 'locked',
    understanding_level: null,
    prerequisites: ['overfitting'],
    created_at: mockCourse.created_at,
    section: 'Model Behavior',
  },
]

export const mockPages: Page[] = [
  {
    id: 'page-linear-1',
    topic_id: 'linear-regression',
    page_number: 1,
    created_at: mockCourse.created_at,
    content:
      'Linear regression is a way to model a relationship between inputs and a continuous output. It asks a simple question: if the input changes, how should the prediction change?\n\nThe model draws a line through the data. That line is not chosen by eye. It is chosen by comparing predictions against real answers and adjusting until the errors are as small as possible.\n\nThe important idea is not the line itself. The important idea is that the model has parameters, the parameters create predictions, and the errors tell us how useful those parameters are.',
  },
  {
    id: 'page-linear-2',
    topic_id: 'linear-regression',
    page_number: 2,
    created_at: mockCourse.created_at,
    content:
      'A linear model assumes each input contributes in a steady direction. If study hours increase by one, the predicted score changes by the same amount each time, according to the learned weight.\n\nThis assumption is useful because it makes the model easy to inspect. You can look at each weight and ask whether the feature pushes the prediction up or down.\n\nBut the assumption can fail. If the real relationship bends, flattens, or changes direction, a straight line may be too simple. TruLurn will test whether you understand that limit, not just whether you can repeat the formula.',
  },
  {
    id: 'page-linear-3',
    topic_id: 'linear-regression',
    page_number: 3,
    created_at: mockCourse.created_at,
    content:
      'The prediction equation is usually written as y = mx + b for one input. The weight m controls the slope. The bias b shifts the line up or down.\n\nFor many inputs, the same idea expands: every feature gets a weight, and the prediction is the weighted sum plus a bias.\n\nDo not memorize the equation as decoration. Read it as a mechanism: inputs are multiplied by importance, added together, then compared against reality.',
  },
]

export const mockDoubts: DoubtMessage[] = [
  {
    id: 'doubt-1',
    topic_id: 'linear-regression',
    page_number: 2,
    role: 'assistant',
    content: 'Ask doubts here, but keep them tied to Linear Regression. I will redirect anything that belongs to a future topic.',
    created_at: mockCourse.created_at,
  },
]

export const mockQuestions: QuizQuestion[] = [
  {
    id: 'q-apply',
    topic_id: 'linear-regression',
    type: 'apply',
    question:
      'A housing model predicts prices using square footage. It works well for average homes but badly for luxury homes. What does this suggest about the linear assumption?',
    rubric:
      'A strong answer explains that a straight-line relationship may be too simple and that the pattern may change across ranges.',
    created_at: mockCourse.created_at,
  },
  {
    id: 'q-error',
    topic_id: 'linear-regression',
    type: 'spot_error',
    question:
      'A student says: "The line with the steepest slope is always the best model because it reacts most strongly to the input." What is wrong with this reasoning?',
    rubric:
      'A strong answer separates slope magnitude from fit quality and references error against real targets.',
    created_at: mockCourse.created_at,
  },
  {
    id: 'q-explain',
    topic_id: 'linear-regression',
    type: 'explain',
    question:
      'Explain linear regression to someone who knows basic algebra but has never trained a model.',
    rubric:
      'A strong answer explains prediction, weights, bias, error, and adjustment in plain language.',
    created_at: mockCourse.created_at,
  },
]

export function getTopic(topicId: string): Topic {
  return mockTopics.find((topic) => topic.id === topicId) ?? mockTopics[0]
}

export function getPages(topicId: string): Page[] {
  const pages = mockPages.filter((page) => page.topic_id === topicId)
  return pages.length > 0 ? pages : mockPages
}

export function getLevelName(level: UnderstandingLevel): string {
  return {
    1: 'Recognition',
    2: 'Mechanical',
    3: 'Conceptual',
    4: 'Transfer',
    5: 'Intuitive',
  }[level]
}

export function evaluateMockAnswer(answer: string, index: number): EvaluationResult {
  const longEnough = answer.trim().length >= 80
  const level = (longEnough ? Math.min(5, 3 + index) : 2) as UnderstandingLevel

  return {
    level,
    passed: level >= 3,
    feedback: longEnough
      ? 'This shows a real mechanism, not just a memorized phrase. Keep tightening the link between prediction, error, and the model assumption.'
      : 'This is still too thin. You named the idea, but you did not explain the mechanism clearly enough to show conceptual understanding.',
    gap: longEnough ? null : 'Explain how the model uses errors to judge whether the line is useful.',
    false_confidence: !longEnough && /\b(easy|obvious|got it|simple)\b/i.test(answer),
  }
}
