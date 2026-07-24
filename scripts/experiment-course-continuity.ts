import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd(), true, console, true)

const { buildCourseContinuityContext, formatCourseContinuityContext } = await import('../lib/topic-pages/courseContinuity.ts')
const { buildGenerationAuthority } = await import('../lib/topic-pages/generationAuthority.ts')
const { generateTopicPage } = await import('../lib/topic-pages/generateTopicPage.ts')
const { evaluateLessonQuality } = await import('../lib/topic-pages/lessonQuality.ts')
const { verifyLessonDraft } = await import('../lib/topic-pages/lessonVerification.ts')

type Fixture = {
  name: string
  prior: {
    id: string
    title: string
    summary: string
    keyConcepts: string[]
    content: string
  }
  current: {
    id: string
    title: string
    description: string
    keyConcepts: string[]
    misconception: string
    focus: string
    targetUnderstanding: string
    factualReference: string
    hardStamp?: {
      kind: 'mental_model' | 'concept_connection' | 'distinction' | 'operational_rule'
      prior_concept: string | null
      current_concept: string
      statement: string
      mapping_steps: string[]
      boundary: string | null
    }
  }
}

const fixtures: Fixture[] = [
  {
    name: 'gradient-descent-to-backpropagation',
    prior: {
      id: 'gradient-descent',
      title: 'Gradient Descent',
      summary: 'Gradient descent uses loss gradients and a learning rate to update parameters in a direction that reduces the objective.',
      keyConcepts: ['loss gradient', 'learning rate', 'parameter update'],
      content: 'For a parameter w and learning rate eta, gradient descent applies w_new = w_old - eta times dL/dw. It consumes a gradient; it does not itself specify how a multilayer network computes that gradient.',
    },
    current: {
      id: 'backpropagation',
      title: 'Backpropagation',
      description: 'Explain reverse-mode differentiation through a neural network and its handoff to the optimizer.',
      keyConcepts: ['chain rule', 'computational graph', 'gradient accumulation', 'weight gradient'],
      misconception: 'Backpropagation and gradient descent are the same process.',
      focus: 'How backpropagation computes weight gradients and hands them to gradient descent',
      targetUnderstanding: 'The learner can distinguish gradient computation by backpropagation from parameter updates by gradient descent and explain the handoff between them.',
      factualReference: 'Backpropagation is an efficient application of the chain rule, commonly implemented as reverse-mode automatic differentiation, that computes derivatives of the loss with respect to intermediate values and parameters. Gradient descent is an optimization rule that uses those derivatives to update parameters. Backpropagation computes gradients; gradient descent consumes gradients to change weights.',
    },
  },
  {
    name: 'conditional-probability-to-bayes-theorem',
    prior: {
      id: 'conditional-probability',
      title: 'Conditional Probability',
      summary: 'Conditional probability P(A|B) restricts attention to outcomes where B occurred and measures how often A also occurs.',
      keyConcepts: ['conditional probability', 'joint probability', 'conditioning event'],
      content: 'Conditional probability is defined by P(A|B) = P(A and B) / P(B) when P(B) is nonzero.',
    },
    current: {
      id: 'bayes-theorem',
      title: 'Bayes’ Theorem',
      description: 'Derive Bayes’ theorem from conditional probability and interpret prior, likelihood, evidence, and posterior.',
      keyConcepts: ['prior', 'likelihood', 'evidence', 'posterior'],
      misconception: 'Bayes’ theorem assumes P(A|B) and P(B|A) are equal.',
      focus: 'Deriving and interpreting Bayes’ theorem from conditional probability',
      targetUnderstanding: 'The learner can derive Bayes’ theorem, interpret every term, and explain why reversing a conditional requires base-rate information.',
      factualReference: 'From P(A|B)=P(A∩B)/P(B) and P(B|A)=P(A∩B)/P(A), equating the two expressions for the joint probability gives P(A|B)=P(B|A)P(A)/P(B), provided P(B)>0. The theorem relates reversed conditionals; it does not claim that they are equal.',
    },
  },
  {
    name: 'logistic-regression-to-single-neuron',
    prior: {
      id: 'logistic-regression',
      title: 'Logistic Regression',
      summary: 'Logistic regression computes a linear score from weighted inputs and bias, then applies the sigmoid function to obtain a probability.',
      keyConcepts: ['linear score', 'sigmoid function', 'binary probability'],
      content: 'Logistic regression first computes z = w^T x + b. It then computes sigma(z), a value between zero and one interpreted as a class probability.',
    },
    current: {
      id: 'single-neuron',
      title: 'Single Neuron',
      description: 'Use logistic regression to reveal the computation performed by one sigmoid neuron, then mark the boundary of that correspondence.',
      keyConcepts: ['pre-activation', 'activation function', 'sigmoid neuron', 'weighted input'],
      misconception: 'The linear score is linear regression, or an entire multilayer neural network is just logistic regression.',
      focus: 'Seeing logistic regression as one sigmoid neuron',
      targetUnderstanding: 'The learner can map the logistic-regression computation onto one sigmoid neuron, use neural-network terminology precisely, and state where the correspondence ends.',
      factualReference: 'A sigmoid neuron computes the affine or linear score z=w^T x+b, commonly called the pre-activation, and then applies the sigmoid activation a=sigma(z). This computation matches logistic regression for a single output unit. The intermediate score is not a linear-regression model, and deeper neural networks compose many neurons and nonlinear transformations.',
      hardStamp: {
        kind: 'concept_connection',
        prior_concept: 'Logistic Regression',
        current_concept: 'Single Neuron',
        statement: 'Logistic regression is the computation performed by one sigmoid neuron.',
        mapping_steps: [
          'linear score z=w^T x+b -> neuron pre-activation',
          'sigmoid function -> activation function',
          'sigmoid output -> neuron activation or probability',
        ],
        boundary: 'This is a one-neuron correspondence; an entire multilayer neural network is not simply logistic regression.',
      },
    },
  },
]

function wordCount(value: string) {
  return value.replace(/[`*_>#|$\\[\\]{}()]/g, ' ').split(/\s+/).filter(Boolean).length
}

async function runFixture(fixture: Fixture) {
  const topics = [
    {
      _id: fixture.prior.id,
      title: fixture.prior.title,
      summary: fixture.prior.summary,
      key_concepts: fixture.prior.keyConcepts,
      sequence_index: 0,
      node_type: 'topic',
      children_count: 0,
    },
    {
      _id: fixture.current.id,
      title: fixture.current.title,
      description: fixture.current.description,
      key_concepts: fixture.current.keyConcepts,
      prerequisites: [fixture.prior.id],
      prerequisite_strength: { [fixture.prior.id]: 'hard' },
      sequence_index: 1,
      node_type: 'topic',
      children_count: 0,
    },
  ]
  const summaries = new Map([[fixture.prior.id, {
    summary: fixture.prior.summary,
    key_concepts: fixture.prior.keyConcepts,
  }]])
  const continuity = buildCourseContinuityContext({
    topics,
    currentTopicId: fixture.current.id,
    taughtTopicIds: [fixture.prior.id],
    summariesByTopic: summaries,
  })

  const architecture = {
    concept_importance: 'critical' as const,
    concept_difficulty: 'high' as const,
    reasoning_need: 'high' as const,
    teaching_depth: 5 as const,
    requires_formal_definition: true,
    misconception_risk: 'high' as const,
    target_understanding: fixture.current.targetUnderstanding,
    success_criteria: [
      `Define ${fixture.current.title} accurately.`,
      `Connect ${fixture.prior.title} to ${fixture.current.title} without conflating them.`,
      'Use the key formula or mechanism in a concrete example.',
    ],
    why_this_matters_now: `The learner already knows ${fixture.prior.title}; this page uses it as the next reasoning step.`,
    required_prior_knowledge: [fixture.prior.title],
    prior_knowledge_repair: [],
    likely_misconceptions: [fixture.current.misconception],
    intuition_plan: `Begin with the missing link left by ${fixture.prior.title}, then formalize the new mechanism.`,
    hard_stamp: fixture.current.hardStamp ?? null,
    representation_plan: ['prose', 'math', 'worked example'],
    example_strategy: {
      opening_example: null,
      worked_example_needed: true,
      contrast_case_needed: true,
      reusable_example_refs: [],
    },
    active_processing: {
      retrieval_prompt: `What did ${fixture.prior.title} produce or consume?`,
      self_explanation_prompt: 'Explain the handoff between the two concepts in your own words.',
      transfer_prompt: null,
    },
    page_sequence_role: 'connect' as const,
    cross_page_connection: `Use ${fixture.prior.title} as established knowledge, then introduce ${fixture.current.title} as a distinct but connected idea.`,
    cognitive_load_notes: ['Name both roles before adding formal detail.'],
    retention_hooks: {
      revisit_concepts: [fixture.prior.title, fixture.current.title],
      retrieval_prompt: null,
      contrast_prompt: fixture.current.misconception,
      transfer_prompt: null,
    },
    recommended_content_kind: 'full_page' as const,
    confidence: 'high' as const,
    reason: 'The dependency and common misconception require an explicit conceptual bridge.',
  }
  const plannedPage = {
    page_number: 1,
    focus: fixture.current.focus,
    content_kind: 'full_page' as const,
    page_sequence_role: 'connect' as const,
    target_length: 'medium' as const,
    target_words: 520,
    soft_max_words: 720,
    concepts: [fixture.current.title, `Connection to ${fixture.prior.title}`],
    start_boundary: `Start from the unresolved question after ${fixture.prior.title}.`,
    end_boundary: `Complete an accurate definition, mechanism, example, and distinction for ${fixture.current.title}.`,
    continues_from_previous: false,
    continues_to_next: false,
    break_preference: 'concept_boundary' as const,
    break_reason: 'The concept and its prerequisite handoff fit in one complete page.',
    brief: architecture,
  }
  const course = {
    title: 'Machine Learning Foundations',
    goals: 'Build technically accurate, connected knowledge suitable for exams and technical interviews.',
    mode: 'ai_teacher',
    knowledge_level: 'intermediate',
    course_depth: 'standard',
    learning_purpose: 'academic',
  }
  const topic = {
    ...topics[1],
    depth: 'deep',
    estimated_pages: 1,
  }
  const authority = buildGenerationAuthority({
    course,
    topic,
    pageNumber: 1,
    pageCount: 1,
    focus: fixture.current.focus,
    plannedPage,
    architecture,
  })
  const memory = {
    pages: [{
      id: `${fixture.prior.id}-page-1`,
      topic_id: fixture.prior.id,
      topic_title: fixture.prior.title,
      page_number: 1,
      focus: fixture.prior.title,
      summary: fixture.prior.summary,
      content: fixture.prior.content,
      score: 1,
      retrieval_methods: ['dependency' as const],
    }],
    doubtMessages: [],
    sourceChunks: [],
    traceId: `experiment-${fixture.name}`,
  }

  let generated: Awaited<ReturnType<typeof generateTopicPage>> | undefined
  let deterministic: ReturnType<typeof evaluateLessonQuality> | undefined
  let semantic: Awaited<ReturnType<typeof verifyLessonDraft>> | undefined
  let qualityRepair: Parameters<typeof generateTopicPage>[0]['qualityRepair']
  let verificationRepair: Parameters<typeof generateTopicPage>[0]['verificationRepair']
  let attempts = 0

  for (attempts = 1; attempts <= 4; attempts += 1) {
    generated = await generateTopicPage({
      course,
      topic,
      pageNumber: 1,
      previousPages: [],
      memory,
      sequenceContext: formatCourseContinuityContext(continuity),
      learningArchitecture: architecture,
      authority,
      lessonResearch: fixture.current.factualReference,
      qualityRepair,
      verificationRepair,
    })
    deterministic = evaluateLessonQuality({
      page: generated,
      topic,
      pageNumber: 1,
      previousPages: [],
      architecture,
      sourceGrounded: false,
      pagePlan: plannedPage,
      continuity,
    })
    semantic = await verifyLessonDraft({
      page: generated,
      topic,
      focus: fixture.current.focus,
      continuity,
      learningArchitecture: architecture,
      factualContext: [fixture.prior.content, fixture.current.factualReference].join('\n'),
    })
    if (deterministic.accepted && semantic.accepted) break

    qualityRepair = deterministic.accepted
      ? undefined
      : { report: deterministic, previousDraft: generated }
    verificationRepair = semantic.accepted ? undefined : semantic
  }

  if (!generated || !deterministic || !semantic || !deterministic.accepted || !semantic.accepted) {
    throw new Error(JSON.stringify({
      fixture: fixture.name,
      deterministic,
      semantic,
      excerpt: generated?.content.slice(0, 1_200),
    }, null, 2))
  }

  return {
    fixture: fixture.name,
    generation_attempts: attempts,
    word_count: wordCount(generated.content),
    retrieved_prior_topics: memory.pages.map((item) => item.topic_title),
    required_bridges: continuity.connections
      .filter((item) => item.required_in_explanation)
      .map((item) => `${item.source_topic_title} -> ${item.target_topic_title}`),
    declared_connections: generated.concept_connections,
    hard_stamped_insights: generated.hard_stamped_insights,
    deterministic: {
      accepted: deterministic.accepted,
      score: deterministic.overall_score,
      issues: deterministic.issues.map((issue) => issue.code),
    },
    semantic: {
      accepted: semantic.accepted,
      scores: semantic.scores,
      relationship_checks: semantic.relationship_checks,
      coverage: semantic.coverage,
      issues: semantic.issues,
    },
    excerpt: generated.content.slice(0, 1_400),
  }
}

const requestedFixture = process.argv
  .find((argument) => argument.startsWith('--fixture='))
  ?.slice('--fixture='.length)
const selectedFixtures = requestedFixture
  ? fixtures.filter((fixture) => fixture.name === requestedFixture)
  : fixtures
if (!selectedFixtures.length) throw new Error(`Unknown fixture: ${requestedFixture}`)

const results = []
for (const fixture of selectedFixtures) results.push(await runFixture(fixture))

console.log(JSON.stringify({ passed: true, fixtures: results }, null, 2))
