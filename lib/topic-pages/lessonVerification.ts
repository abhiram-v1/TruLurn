import { generateAI, parseAIJson } from '@/lib/ai'
import type { CourseContinuityContext } from './courseContinuity'
import type { GeneratedTopicPage } from './generateTopicPage'

export type LessonVerificationIssue = {
  code: string
  severity: 'critical' | 'warning'
  message: string
  repair_instruction: string
}

export type LessonRelationshipCheck = {
  source_concept: string
  target_concept: string
  roles_distinct: boolean
  relationship_explicit: boolean
  technically_accurate: boolean
  notes: string
}

export type LessonVerificationReport = {
  version: 'lesson-verification-v1'
  accepted: boolean
  scores: {
    factual_accuracy: number
    internal_consistency: number
    continuity: number
    dependency_clarity: number
    terminology_consistency: number
    instructional_coverage: number
  }
  issues: LessonVerificationIssue[]
  relationship_checks: LessonRelationshipCheck[]
  coverage: {
    definition: 'present' | 'not_required' | 'missing'
    intuition: 'present' | 'not_required' | 'missing'
    mechanism: 'present' | 'not_required' | 'missing'
    formula: 'present' | 'not_required' | 'missing'
    example: 'present' | 'not_required' | 'missing'
    prior_connection: 'present' | 'not_required' | 'missing'
    hard_stamp: 'present' | 'not_required' | 'missing'
  }
  summary: string
  verified_at: Date
}

export class LessonVerificationError extends Error {
  readonly code = 'LESSON_VERIFICATION_REJECTED'
  readonly report: LessonVerificationReport

  constructor(report: LessonVerificationReport) {
    const critical = report.issues.find((issue) => issue.severity === 'critical')
    super(critical?.message || report.summary || 'The lesson failed factual and continuity verification.')
    this.name = 'LessonVerificationError'
    this.report = report
  }
}

function clampScore(value: unknown) {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
}

function compact(value: unknown, max = 700) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function normalizeCoverage(value: unknown): 'present' | 'not_required' | 'missing' {
  return value === 'present' || value === 'not_required' ? value : 'missing'
}

export function normalizeLessonVerificationReport(raw: any): LessonVerificationReport {
  const rawScoreValues = [
    raw?.scores?.factual_accuracy,
    raw?.scores?.internal_consistency,
    raw?.scores?.continuity,
    raw?.scores?.dependency_clarity,
    raw?.scores?.terminology_consistency,
    raw?.scores?.instructional_coverage,
  ].map(Number)
  // Some providers follow an implicit probability convention and return 0-1
  // even when a reviewer prompt asks for percentages. Normalize that complete
  // shape defensively; mixed scales remain invalid rather than being guessed.
  const unitScale = rawScoreValues.every((score) => Number.isFinite(score) && score >= 0 && score <= 1)
  const normalizedScore = (value: unknown) => clampScore(Number(value) * (unitScale ? 100 : 1))
  const scores = {
    factual_accuracy: normalizedScore(raw?.scores?.factual_accuracy),
    internal_consistency: normalizedScore(raw?.scores?.internal_consistency),
    continuity: normalizedScore(raw?.scores?.continuity),
    dependency_clarity: normalizedScore(raw?.scores?.dependency_clarity),
    terminology_consistency: normalizedScore(raw?.scores?.terminology_consistency),
    instructional_coverage: normalizedScore(raw?.scores?.instructional_coverage),
  }
  const issues: LessonVerificationIssue[] = Array.isArray(raw?.issues)
    ? raw.issues.slice(0, 12).map((issue: any) => ({
        code: compact(issue?.code, 80) || 'unspecified_issue',
        severity: issue?.severity === 'warning' ? 'warning' : 'critical',
        message: compact(issue?.message),
        repair_instruction: compact(issue?.repair_instruction),
      }))
    : []
  const relationshipChecks: LessonRelationshipCheck[] = Array.isArray(raw?.relationship_checks)
    ? raw.relationship_checks.slice(0, 12).map((check: any) => ({
        source_concept: compact(check?.source_concept, 120),
        target_concept: compact(check?.target_concept, 120),
        roles_distinct: Boolean(check?.roles_distinct),
        relationship_explicit: Boolean(check?.relationship_explicit),
        technically_accurate: Boolean(check?.technically_accurate),
        notes: compact(check?.notes),
      }))
    : []
  const coverage = {
    definition: normalizeCoverage(raw?.coverage?.definition),
    intuition: normalizeCoverage(raw?.coverage?.intuition),
    mechanism: normalizeCoverage(raw?.coverage?.mechanism),
    formula: normalizeCoverage(raw?.coverage?.formula),
    example: normalizeCoverage(raw?.coverage?.example),
    prior_connection: normalizeCoverage(raw?.coverage?.prior_connection),
    hard_stamp: normalizeCoverage(raw?.coverage?.hard_stamp),
  }
  const criticalIssue = issues.some((issue) => issue.severity === 'critical')
  const failedRelationship = relationshipChecks.some((check) =>
    !check.roles_distinct || !check.relationship_explicit || !check.technically_accurate
  )
  const scoreFloorFailed = Math.min(...Object.values(scores)) < 72

  return {
    version: 'lesson-verification-v1',
    accepted: Boolean(raw?.accepted) && !criticalIssue && !failedRelationship && !scoreFloorFailed,
    scores,
    issues,
    relationship_checks: relationshipChecks,
    coverage,
    summary: compact(raw?.summary),
    verified_at: new Date(),
  }
}

export function enforceHardStampVerification(
  report: LessonVerificationReport,
  hardStampRequired: boolean,
) {
  if (!hardStampRequired || report.coverage.hard_stamp === 'present') return report
  return {
    ...report,
    accepted: false,
    issues: [...report.issues, {
      code: 'hard_stamp_not_verified',
      severity: 'critical' as const,
      message: 'The independent reviewer could not verify the required hard-stamped mental model.',
      repair_instruction: 'Add one visible "Lock this in" callout that states the exact mapping and its boundary, then align the structured hard_stamped_insights record.',
    }],
  }
}

export async function verifyLessonDraft({
  page,
  topic,
  focus,
  continuity,
  learningArchitecture,
  factualContext,
}: {
  page: GeneratedTopicPage
  topic: any
  focus: string
  continuity: CourseContinuityContext
  learningArchitecture?: any
  factualContext?: string
}) {
  const requiredConnections = continuity.connections.filter((connection) => connection.required_in_explanation)
  const priorEvidence = requiredConnections.map((connection) => ({
    source_concept: connection.source_topic_title,
    target_concept: connection.target_topic_title,
    prior_summary: connection.evidence_summary,
    prior_key_concepts: connection.evidence_concepts,
    required: true,
  }))

  const rawText = await generateAI({
    feature: 'page_analysis',
    purpose: 'primary',
    reasoningEffort: 'high',
    responseMimeType: 'text/plain',
    responseSchema: {
      name: 'lesson_continuity_accuracy_verification',
      schema: {
        type: 'object',
        properties: {
          accepted: { type: 'boolean' },
          scores: {
            type: 'object',
            properties: {
              factual_accuracy: { type: 'number' },
              internal_consistency: { type: 'number' },
              continuity: { type: 'number' },
              dependency_clarity: { type: 'number' },
              terminology_consistency: { type: 'number' },
              instructional_coverage: { type: 'number' },
            },
            required: ['factual_accuracy', 'internal_consistency', 'continuity', 'dependency_clarity', 'terminology_consistency', 'instructional_coverage'],
          },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                severity: { type: 'string', enum: ['critical', 'warning'] },
                message: { type: 'string' },
                repair_instruction: { type: 'string' },
              },
              required: ['code', 'severity', 'message', 'repair_instruction'],
            },
          },
          relationship_checks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source_concept: { type: 'string' },
                target_concept: { type: 'string' },
                roles_distinct: { type: 'boolean' },
                relationship_explicit: { type: 'boolean' },
                technically_accurate: { type: 'boolean' },
                notes: { type: 'string' },
              },
              required: ['source_concept', 'target_concept', 'roles_distinct', 'relationship_explicit', 'technically_accurate', 'notes'],
            },
          },
          coverage: {
            type: 'object',
            properties: {
              definition: { type: 'string', enum: ['present', 'not_required', 'missing'] },
              intuition: { type: 'string', enum: ['present', 'not_required', 'missing'] },
              mechanism: { type: 'string', enum: ['present', 'not_required', 'missing'] },
              formula: { type: 'string', enum: ['present', 'not_required', 'missing'] },
              example: { type: 'string', enum: ['present', 'not_required', 'missing'] },
              prior_connection: { type: 'string', enum: ['present', 'not_required', 'missing'] },
              hard_stamp: { type: 'string', enum: ['present', 'not_required', 'missing'] },
            },
            required: ['definition', 'intuition', 'mechanism', 'formula', 'example', 'prior_connection', 'hard_stamp'],
          },
          summary: { type: 'string' },
        },
        required: ['accepted', 'scores', 'issues', 'relationship_checks', 'coverage', 'summary'],
      },
    },
    system: `You are the independent quality gate for a high-stakes educational lesson.
Check claims and formulas for technical accuracy, internal consistency, prerequisite use, terminology, and instructional completeness. Do not reward polished prose that teaches a false relationship.
Every score must be an integer from 0 to 100, where 100 means fully correct and complete. Never use a 0-to-1 scale.
For every required concept connection, verify that the lesson explicitly names both concepts, distinguishes their jobs, and explains the direction of the dependency or information flow. Two adjacent definitions are not a connection.
When the architecture contains a hard_stamp, require one visible "Lock this in" callout. Verify that it states the core idea directly, gives the concrete operation-to-operation or term-to-term mapping, and states the boundary when the correspondence is not an identity. Reject a catchy but vague slogan.
The lesson renderer owns exactly four card treatments: Definition, Example, fenced Code with an explicit language, and Lock this in. Reject invented or legacy labeled cards such as Note, Tip, Warning, Remember, TL;DR, Key insight, Mental model, custom HTML/MDX, or ::: containers. Also reject misuse: a Definition card that is not a definition, an Example card without a concrete worked case and interpretation, decorative or unexplained code, more than one Lock this in card, or cards used as generic section wrappers.
Mark a claim uncertain when the supplied factual context cannot support it. Mark a relationship inaccurate when two distinct processes are conflated.
Coverage is contextual: require a definition, intuition, mechanism, formula, or example only when the focus or learning architecture calls for it. Return JSON only.`,
    user: `CURRENT TOPIC: ${String(topic?.title ?? 'Current topic')}
PAGE FOCUS: ${focus}

REQUIRED PRIOR CONNECTIONS:
${JSON.stringify(priorEvidence, null, 2)}

CANONICAL TERMS:
${continuity.canonical_terms.join('; ') || 'none'}

LEARNING ARCHITECTURE:
${JSON.stringify(learningArchitecture ?? {}, null, 2)}

FACTUAL REFERENCE CONTEXT:
${compact(factualContext || 'No external factual reference was available; verify only claims that are stable and well established.', 9_000)}

CANDIDATE LESSON:
${page.content.slice(0, 18_000)}

CANDIDATE CONNECTION METADATA:
${JSON.stringify(page.concept_connections ?? [], null, 2)}`,
  })

  const report = normalizeLessonVerificationReport(parseAIJson<any>(rawText))
  return enforceHardStampVerification(report, Boolean(learningArchitecture?.hard_stamp))
}

export function buildLessonVerificationRepairDirective(report: LessonVerificationReport) {
  const issues = report.issues.length
    ? report.issues.map((issue) => `- [${issue.severity.toUpperCase()}] ${issue.message} Repair: ${issue.repair_instruction}`).join('\n')
    : '- The independent reviewer found an unresolved relationship or score-floor failure; make every required bridge explicit, distinct, and technically accurate.'
  return `INDEPENDENT LESSON VERIFICATION REPAIR:
The previous draft failed the high-stakes accuracy and continuity gate.
${issues}

Rewrite the complete page. Preserve locked scope and page boundaries. Correct false claims, make prerequisite-to-current handoffs explicit, preserve canonical terminology, and add only genuinely missing definition/intuition/mechanism/formula/example coverage.`
}
