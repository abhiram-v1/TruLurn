import type {
  CompactCurriculumSource,
  CompactSourceSection,
} from './sourceCompaction.ts'
import type {
  SourceCurriculumIssue,
  SourceCurriculumValidationReport,
} from './sourceCurriculumIntegrity.ts'
import { classifySourceCurriculumIssues } from './sourceCurriculumIntegrity.ts'

export const CURRICULUM_REPAIR_PROMPT_VERSION = 'curriculum-repair-v1'

type TopicWithRefs = {
  id: string
  source_refs: string[]
}

function collectTopics(curriculum: any): TopicWithRefs[] {
  const topics: TopicWithRefs[] = []
  const visit = (topic: any) => {
    if (!topic || typeof topic !== 'object') return
    topics.push({
      id: String(topic.id ?? ''),
      source_refs: Array.isArray(topic.source_refs)
        ? topic.source_refs.map(String)
        : [],
    })
    for (const child of Array.isArray(topic.children) ? topic.children : []) visit(child)
  }
  for (const branch of Array.isArray(curriculum?.branches) ? curriculum.branches : []) {
    for (const section of Array.isArray(branch?.sections) ? branch.sections : []) {
      for (const topic of Array.isArray(section?.topics) ? section.topics : []) visit(topic)
    }
  }
  return topics
}

function formatSection(
  sourceTitle: string,
  section: CompactSourceSection,
) {
  const path = section.heading_path.join(' > ') || 'Root Section'
  return [
    `## Section [${section.id}]: ${sourceTitle} — ${path}`,
    section.opening_excerpt ? `Excerpt: ${section.opening_excerpt}` : null,
    section.key_definitions.length
      ? `Definitions:\n- ${section.key_definitions.join('\n- ')}`
      : null,
    section.learning_objectives.length
      ? `Objectives:\n- ${section.learning_objectives.join('\n- ')}`
      : null,
    section.enumerations.length
      ? `Key lists:\n- ${section.enumerations.join('\n- ')}`
      : null,
    section.table_summaries.length
      ? `Tables:\n${section.table_summaries.join('\n')}`
      : null,
  ].filter(Boolean).join('\n')
}

export function selectCurriculumRepairEvidence(
  compact: CompactCurriculumSource | null | undefined,
  curriculum: any,
  issues: SourceCurriculumIssue[],
) {
  if (!compact) return ''

  const needsBroadEvidence = issues.some((issue) =>
    issue.code === 'missing_source_refs'
    || issue.code === 'invalid_source_ref'
    || issue.code === 'source_order_violation'
    || issue.code === 'excessive_root_topics'
    || issue.code === 'excessive_total_topics',
  )

  const topicIds = new Set(
    issues.map((issue) => issue.topicId).filter(Boolean) as string[],
  )
  const referencedIds = new Set(
    collectTopics(curriculum)
      .filter((topic) => topicIds.has(topic.id))
      .flatMap((topic) => topic.source_refs),
  )

  const sections: string[] = []
  for (const source of compact.sources) {
    for (const section of source.sections) {
      if (
        needsBroadEvidence
        || referencedIds.size === 0
        || referencedIds.has(section.id)
      ) {
        sections.push(formatSection(source.title, section))
      }
    }
  }
  return sections.join('\n\n')
}

export function shouldAttemptSourceCurriculumModelRepair(
  report: SourceCurriculumValidationReport,
) {
  return classifySourceCurriculumIssues(report.issues).substantive.length > 0
}

export function buildSourceCurriculumRepairPrompt(input: {
  candidate: any
  report: SourceCurriculumValidationReport
  compactSource?: CompactCurriculumSource | null
  sourceProfile?: string
  sourceOrderAnalysis?: string
}) {
  const substantive = classifySourceCurriculumIssues(input.report.issues).substantive
  const evidence = selectCurriculumRepairEvidence(
    input.compactSource,
    input.candidate,
    substantive,
  )

  return {
    system: `You repair TruLurn source-grounded curricula.
Return a complete replacement curriculum as JSON. Every sub-topic must be nested
inside its parent topic's "children" array — never as a sibling or a separate list.
The supplied source evidence is the complete syllabus boundary. Preserve valid
content and structure; change only what is necessary to fix the listed defects.
Never invent evidence, source IDs, prerequisites, or broader subject topics.`,
    user: `Repair this source-grounded curriculum.

Validation defects:
${substantive.map((issue) =>
    `- ${issue.code}${issue.topicId ? ` [${issue.topicId}]` : ''}: ${issue.message}`,
  ).join('\n')}

Repair rules:
- Every retained topic must be taught by its cited source_refs.
- Use only section IDs visible in the evidence below.
- Remove an unsupported topic when no evidence teaches it; do not disguise it with an unrelated citation.
- Preserve uploaded source order unless a real source-backed prerequisite requires conceptual_reorder_allowed.
- Merge or nest shallow fragments when the issue is excessive topic count.
- Keep valid IDs, hierarchy, metadata, and prerequisites unchanged where possible.

${input.sourceProfile ? `Source boundary profile:\n${input.sourceProfile}\n` : ''}
${input.sourceOrderAnalysis ? `Source order analysis:\n${input.sourceOrderAnalysis}\n` : ''}
Relevant source evidence:
${evidence || 'No compact source evidence is available. Remove unsupported material rather than guessing.'}

Candidate curriculum:
${JSON.stringify(input.candidate)}`,
  }
}
