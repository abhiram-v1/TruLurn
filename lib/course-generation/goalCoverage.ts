import { generateAI, parseAIJson } from '@/lib/ai'

// ── Goal coverage check ────────────────────────────────────────────────────────
// After the curriculum is generated, verify that every concept the learner
// EXPLICITLY named in their goal actually appears somewhere in the plan.
// Semantic matching is delegated to a fast model so synonyms count as covered
// ("union-find" vs "Disjoint Set Union"). The report is advisory: it renders
// as a warning on the curriculum review screen where the learner decides.
// Any failure returns null — coverage checking must never block generation.

export type GoalCoverageConcept = {
  concept: string
  covered: boolean
  matched_topic: string | null
}

export type GoalCoverageReport = {
  schema_version: 'goal-coverage-v1'
  checked_at: string
  concepts: GoalCoverageConcept[]
}

const MAX_TOPIC_TITLES = 400
const MAX_CONCEPTS = 15

function collectTopicTitles(curriculum: any): string[] {
  const titles: string[] = []
  const visit = (topic: any) => {
    if (!topic || typeof topic !== 'object') return
    const title = String(topic.title ?? '').trim()
    if (title) titles.push(title)
    for (const child of Array.isArray(topic.children) ? topic.children : []) visit(child)
  }
  for (const branch of Array.isArray(curriculum?.branches) ? curriculum.branches : []) {
    const branchTitle = String(branch?.title ?? '').trim()
    if (branchTitle) titles.push(branchTitle)
    for (const section of Array.isArray(branch?.sections) ? branch.sections : []) {
      for (const topic of Array.isArray(section?.topics) ? section.topics : []) visit(topic)
    }
  }
  return titles.slice(0, MAX_TOPIC_TITLES)
}

function sanitizeReport(raw: unknown): GoalCoverageReport | null {
  if (!raw || typeof raw !== 'object') return null
  const concepts = (raw as Record<string, unknown>).concepts
  if (!Array.isArray(concepts)) return null

  const cleaned: GoalCoverageConcept[] = []
  for (const entry of concepts.slice(0, MAX_CONCEPTS)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const concept = String(record.concept ?? '').trim().slice(0, 80)
    if (!concept) continue
    cleaned.push({
      concept,
      covered: record.covered === true,
      matched_topic:
        typeof record.matched_topic === 'string' && record.matched_topic.trim()
          ? record.matched_topic.trim().slice(0, 120)
          : null,
    })
  }

  return {
    schema_version: 'goal-coverage-v1',
    checked_at: new Date().toISOString(),
    concepts: cleaned,
  }
}

const SYSTEM = `You audit course plans. Given a learner's goal and the plan's full topic list, do two things:
1. Extract the concrete concepts, techniques, technologies, or subtopics the learner EXPLICITLY names in the goal. Only literal asks — never implied prerequisites, never generic phrases ("the basics", "everything important"), never the subject itself when it is the whole course. At most ${MAX_CONCEPTS}.
2. For each extracted concept, decide whether the topic list covers it. A topic counts as covering a concept when its title names the concept, a standard synonym, or an unambiguous umbrella for it (e.g. "Disjoint Set Union" covers "union-find"; "Sorting Algorithms" covers "merge sort" only if no more specific topic exists — prefer marking specific named algorithms covered only when identifiable in the list).

Return ONLY valid JSON, no markdown:
{ "concepts": [ { "concept": string, "covered": boolean, "matched_topic": string | null } ] }
matched_topic is the exact covering title from the list, or null when covered is false.
If the goal names no specific concepts, return { "concepts": [] }.`

export async function buildGoalCoverageReport(input: {
  goals: string
  curriculum: any
}): Promise<GoalCoverageReport | null> {
  const goals = input.goals?.trim()
  const titles = collectTopicTitles(input.curriculum)
  if (!goals || titles.length === 0) return null

  try {
    const raw = await generateAI({
      feature: 'goal_coverage_check',
      system: SYSTEM,
      user: `Learner goal:\n${goals}\n\nPlan topic list:\n${titles.map((t) => `- ${t}`).join('\n')}`,
      responseMimeType: 'application/json',
    })
    return sanitizeReport(parseAIJson<unknown>(raw))
  } catch (error) {
    console.warn('[goalCoverage] Coverage check failed — skipping.', error)
    return null
  }
}
