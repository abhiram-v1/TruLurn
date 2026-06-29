import type { LearningArchitectureBrief, PageSequenceRole } from '../learning-architecture/analyzePage'
import type { PageTargetLength, TopicPagePlan } from '../learning-architecture/analyzeTopicPlan'
import type { GeneratedTopicPage } from './generateTopicPage'
import type { ContentKind } from '../../types'

export type PageMode = 'micro' | 'short' | 'full' | 'critical'

export type GenerationAuthorityContract = {
  version: 'generation-authority-v1'
  scope: {
    owner: 'course_boundary'
    allowed: boolean
    mode: 'source_grounded' | 'ai_teacher'
    reason: string
  }
  sequence: {
    owner: 'topic_plan'
    page_number: number
    page_count: number
    focus: string
    content_kind: ContentKind
    page_mode: PageMode
    target_length: PageTargetLength
    page_sequence_role: PageSequenceRole
    should_generate_page: boolean
    target_words: number
    soft_max_words: number
    concepts: string[]
    start_boundary: string
    end_boundary: string
    continues_from_previous: boolean
    continues_to_next: boolean
    break_preference: TopicPagePlan['break_preference']
    break_reason: string
  }
  objective: {
    owner: 'page_brief'
    target_understanding: string
    success_criteria: string[]
  }
  writer: {
    owner: 'lesson_writer'
    controls: readonly [
      'wording',
      'examples',
      'representation',
      'section_usage',
      'tone',
    ]
  }
  acceptance: {
    owner: 'lesson_quality_evaluator'
    threshold: number
  }
}

export class CourseScopeError extends Error {
  readonly code = 'COURSE_SCOPE_REJECTED'
  readonly contract: GenerationAuthorityContract

  constructor(contract: GenerationAuthorityContract) {
    super(contract.scope.reason)
    this.name = 'CourseScopeError'
    this.contract = contract
  }
}

function pageModeFor(contentKind: ContentKind, targetLength: PageTargetLength): PageMode {
  if (contentKind === 'bridge' || contentKind === 'skip') return 'micro'
  if (contentKind === 'section' || contentKind === 'example') return 'short'
  return targetLength === 'long' ? 'critical' : 'full'
}

function fallbackPlan(input: {
  pageNumber: number
  focus: string
  architecture?: LearningArchitectureBrief
}): TopicPagePlan {
  const contentKind = input.architecture?.recommended_content_kind === 'skip'
    ? 'full_page'
    : input.architecture?.recommended_content_kind ?? 'full_page'
  return {
    page_number: input.pageNumber,
    focus: input.focus,
    content_kind: contentKind,
    page_sequence_role: input.architecture?.page_sequence_role ?? 'introduce',
    target_length: contentKind === 'full_page' ? 'medium' : 'short',
    target_words: contentKind === 'full_page' ? 560 : 320,
    soft_max_words: contentKind === 'full_page' ? 680 : 420,
    concepts: [input.focus],
    start_boundary: input.focus,
    end_boundary: input.focus,
    continues_from_previous: input.pageNumber > 1,
    continues_to_next: false,
    break_preference: 'natural_pause',
    break_reason: 'Fallback page boundary.',
    brief: input.architecture ?? null,
  }
}

export function buildGenerationAuthority(input: {
  course: any
  topic: any
  pageNumber: number
  pageCount: number
  focus: string
  plannedPage?: TopicPagePlan | null
  architecture?: LearningArchitectureBrief
  qualityThreshold?: number
}): GenerationAuthorityContract {
  const mode = String(input.course?.mode ?? '') === 'source_grounded'
    ? 'source_grounded'
    : 'ai_teacher'
  const sourceCoverage = String(input.topic?.source_coverage ?? '')
  const scopeAllowed = mode !== 'source_grounded' || sourceCoverage === 'covered'
  const plan = input.plannedPage ?? fallbackPlan(input)
  const shouldGenerate = plan.content_kind !== 'skip'

  return {
    version: 'generation-authority-v1',
    scope: {
      owner: 'course_boundary',
      allowed: scopeAllowed,
      mode,
      reason: scopeAllowed
        ? 'The topic is inside the course boundary.'
        : `Source-grounded generation requires a covered canonical topic; received source_coverage "${sourceCoverage || 'missing'}".`,
    },
    sequence: {
      owner: 'topic_plan',
      page_number: input.pageNumber,
      page_count: Math.max(1, input.pageCount),
      focus: plan.focus || input.focus,
      content_kind: plan.content_kind,
      page_mode: pageModeFor(plan.content_kind, plan.target_length),
      target_length: plan.target_length,
      page_sequence_role: plan.page_sequence_role,
      should_generate_page: shouldGenerate,
      target_words: plan.target_words,
      soft_max_words: plan.soft_max_words,
      concepts: plan.concepts,
      start_boundary: plan.start_boundary,
      end_boundary: plan.end_boundary,
      continues_from_previous: plan.continues_from_previous,
      continues_to_next: plan.continues_to_next,
      break_preference: plan.break_preference,
      break_reason: plan.break_reason,
    },
    objective: {
      owner: 'page_brief',
      target_understanding: input.architecture?.target_understanding
        || plan.focus
        || input.focus,
      success_criteria: input.architecture?.success_criteria ?? [],
    },
    writer: {
      owner: 'lesson_writer',
      controls: ['wording', 'examples', 'representation', 'section_usage', 'tone'],
    },
    acceptance: {
      owner: 'lesson_quality_evaluator',
      threshold: input.qualityThreshold ?? 75,
    },
  }
}

export function enforceGenerationAuthority(
  page: GeneratedTopicPage,
  contract: GenerationAuthorityContract,
): GeneratedTopicPage {
  return {
    ...page,
    page_number: contract.sequence.page_number,
    focus: contract.sequence.focus,
    content_kind: contract.sequence.content_kind,
    page_mode: contract.sequence.page_mode,
    estimated_length: contract.sequence.target_length,
    should_generate_page: contract.sequence.should_generate_page,
    core_realization: contract.objective.target_understanding,
    decision_reason: `Page shape locked by ${contract.sequence.owner}; acceptance is decided by ${contract.acceptance.owner}.`,
    generation_authority: contract,
  }
}

export function formatGenerationAuthority(contract: GenerationAuthorityContract) {
  return `GENERATION AUTHORITY CONTRACT:
- COURSE BOUNDARY owns scope: ${contract.scope.allowed ? 'allowed' : 'rejected'}.
- TOPIC PLAN owns sequence and shape: page ${contract.sequence.page_number} of ${contract.sequence.page_count}, content_kind "${contract.sequence.content_kind}", page_mode "${contract.sequence.page_mode}", target_length "${contract.sequence.target_length}", role "${contract.sequence.page_sequence_role}".
- PHYSICAL PAGE SPAN: begin at "${contract.sequence.start_boundary}" and reach "${contract.sequence.end_boundary}".
- CONCEPT FLOW: ${contract.sequence.concepts.join(' -> ') || 'follow the planned span'}.
- LENGTH BUDGET: ${contract.sequence.target_words} words is the expected teaching budget for this span, not a padding quota; ${contract.sequence.soft_max_words} is the soft maximum for finishing a nearly complete thought.
- CONTINUITY: continues from previous=${contract.sequence.continues_from_previous}; continues to next=${contract.sequence.continues_to_next}; preferred break=${contract.sequence.break_preference}. ${contract.sequence.break_reason}
- PAGE BRIEF owns the learning objective: ${contract.objective.target_understanding}
- LESSON WRITER owns only wording, examples, representation, optional section usage, and tone.
- QUALITY EVALUATOR owns acceptance at threshold ${contract.acceptance.threshold}.

Do not change page count, focus, content kind, page mode, length budget, boundaries, continuation flags, sequence role, or whether this page exists.`
}
