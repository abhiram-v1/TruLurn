import crypto from 'crypto'
import type { Db } from 'mongodb'

export const RETRIEVAL_CUTOVER_WORKFLOWS = [
  'generic',
  'lesson_generation',
  'doubt_answer',
  'topic_planning',
] as const

export type RetrievalCutoverWorkflow = (typeof RETRIEVAL_CUTOVER_WORKFLOWS)[number]
export type RetrievalCutoverMode = 'legacy' | 'shadow' | 'canary' | 'v2'
export type RetrievalSelectionVersion = 'dense-v1' | 'hybrid-v2'

export type WorkflowCutoverPolicy = {
  mode: RetrievalCutoverMode
  rolloutPercent: number
}

export type RetrievalCutoverConfig = {
  userId: string
  seed: string
  workflows: Record<RetrievalCutoverWorkflow, WorkflowCutoverPolicy>
  updatedAt: Date | null
}

export type ResolvedRetrievalCutover = {
  workflow: RetrievalCutoverWorkflow
  mode: RetrievalCutoverMode
  rolloutPercent: number
  cohortBucket: number
  canarySelected: boolean
  selectionVersion: RetrievalSelectionVersion
  collectShadow: boolean
  seed: string
}

const DEFAULT_MODE = normalizeMode(process.env.RAG_CUTOVER_DEFAULT_MODE) ?? 'v2'
const DEFAULT_ROLLOUT_PERCENT = clampPercent(
  Number(process.env.RAG_CUTOVER_DEFAULT_PERCENT ?? 0),
)

function normalizeMode(value: unknown): RetrievalCutoverMode | null {
  return value === 'legacy' || value === 'shadow' || value === 'canary' || value === 'v2'
    ? value
    : null
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

export function cohortBucket(input: {
  seed: string
  userId: string
  courseId: string
  workflow: RetrievalCutoverWorkflow
}) {
  const digest = crypto
    .createHash('sha256')
    .update(`${input.seed}:${input.userId}:${input.courseId}:${input.workflow}`)
    .digest()
  return digest.readUInt32BE(0) / 0x1_0000_0000 * 100
}

export function resolveCutoverSelection(input: {
  workflow: RetrievalCutoverWorkflow
  policy: WorkflowCutoverPolicy
  seed: string
  userId: string
  courseId: string
}): ResolvedRetrievalCutover {
  const rolloutPercent = clampPercent(input.policy.rolloutPercent)
  const bucket = cohortBucket(input)
  const canarySelected = input.policy.mode === 'canary' && bucket < rolloutPercent
  const selectionVersion: RetrievalSelectionVersion =
    input.policy.mode === 'v2' || canarySelected ? 'hybrid-v2' : 'dense-v1'

  return {
    workflow: input.workflow,
    mode: input.policy.mode,
    rolloutPercent,
    cohortBucket: bucket,
    canarySelected,
    selectionVersion,
    collectShadow: input.policy.mode !== 'legacy',
    seed: input.seed,
  }
}

function defaultWorkflowPolicy(): WorkflowCutoverPolicy {
  return {
    mode: DEFAULT_MODE,
    rolloutPercent: DEFAULT_MODE === 'canary' ? DEFAULT_ROLLOUT_PERCENT : 0,
  }
}

function normalizeWorkflowPolicy(value: unknown): WorkflowCutoverPolicy {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const mode = normalizeMode(raw.mode) ?? DEFAULT_MODE
  return {
    mode,
    rolloutPercent: mode === 'canary'
      ? clampPercent(Number(raw.rollout_percent ?? raw.rolloutPercent ?? DEFAULT_ROLLOUT_PERCENT))
      : 0,
  }
}

export async function getRetrievalCutoverConfig(
  db: Db,
  userId: string,
): Promise<RetrievalCutoverConfig> {
  const stored = await db.collection('ragCutoverConfigs').findOne({ _id: userId as any })
  const seed = String(stored?.seed ?? process.env.RAG_CUTOVER_SEED ?? 'trulurn-rag-v2')
  const storedWorkflows = stored?.workflows && typeof stored.workflows === 'object'
    ? stored.workflows as Record<string, unknown>
    : {}

  return {
    userId,
    seed,
    workflows: Object.fromEntries(
      RETRIEVAL_CUTOVER_WORKFLOWS.map((workflow) => [
        workflow,
        storedWorkflows[workflow]
          ? normalizeWorkflowPolicy(storedWorkflows[workflow])
          : defaultWorkflowPolicy(),
      ]),
    ) as Record<RetrievalCutoverWorkflow, WorkflowCutoverPolicy>,
    updatedAt: stored?.updated_at instanceof Date ? stored.updated_at : null,
  }
}

export async function updateRetrievalCutoverConfig(
  db: Db,
  userId: string,
  input: {
    seed?: string
    workflows?: Partial<Record<RetrievalCutoverWorkflow, Partial<WorkflowCutoverPolicy>>>
  },
) {
  const current = await getRetrievalCutoverConfig(db, userId)
  const workflows = { ...current.workflows }

  for (const workflow of RETRIEVAL_CUTOVER_WORKFLOWS) {
    const next = input.workflows?.[workflow]
    if (!next) continue
    const mode = next.mode ?? workflows[workflow].mode
    if (!normalizeMode(mode)) {
      throw new Error(`Invalid cutover mode for ${workflow}.`)
    }
    workflows[workflow] = {
      mode,
      rolloutPercent: mode === 'canary'
        ? clampPercent(Number(next.rolloutPercent ?? workflows[workflow].rolloutPercent))
        : 0,
    }
  }

  const seed = input.seed?.trim() || current.seed
  const updatedAt = new Date()
  await db.collection('ragCutoverConfigs').updateOne(
    { _id: userId as any },
    {
      $set: {
        user_id: userId,
        seed,
        workflows: Object.fromEntries(
          RETRIEVAL_CUTOVER_WORKFLOWS.map((workflow) => [
            workflow,
            {
              mode: workflows[workflow].mode,
              rollout_percent: workflows[workflow].rolloutPercent,
            },
          ]),
        ),
        updated_at: updatedAt,
      },
      $setOnInsert: { created_at: updatedAt },
    },
    { upsert: true },
  )

  return getRetrievalCutoverConfig(db, userId)
}

export async function resolveRetrievalCutover(
  db: Db,
  input: {
    workflow: RetrievalCutoverWorkflow
    userId: string
    courseId: string
  },
) {
  const config = await getRetrievalCutoverConfig(db, input.userId)
  return resolveCutoverSelection({
    ...input,
    policy: config.workflows[input.workflow],
    seed: config.seed,
  })
}

function overlapRatio(left: string[], right: string[]) {
  if (!left.length && !right.length) return null
  if (!left.length || !right.length) return 0
  const rightIds = new Set(right)
  return left.filter((id) => rightIds.has(id)).length / Math.max(left.length, right.length)
}

export async function getRetrievalParityReport(
  db: Db,
  userId: string,
  limit = 500,
) {
  const traces = await db.collection('retrievalTraces')
    .find({
      user_id: userId,
      'shadow_comparison.baseline_selected_ids': { $exists: true },
      'shadow_comparison.hybrid_selected_ids': { $exists: true },
      $or: [
        { 'cutover.shadow_collected': true },
        { cutover: { $exists: false } },
      ],
    })
    .sort({ created_at: -1 })
    .limit(Math.max(1, Math.min(2_000, limit)))
    .project({ workflow: 1, shadow_comparison: 1, status: 1, duration_ms: 1 })
    .toArray()

  return Object.fromEntries(RETRIEVAL_CUTOVER_WORKFLOWS.map((workflow) => {
    const workflowTraces = traces.filter((trace) => trace.workflow === workflow)
    const overlaps = workflowTraces.map((trace) => {
      const baseline = trace.shadow_comparison?.baseline_selected_ids ?? {}
      const hybrid = trace.shadow_comparison?.hybrid_selected_ids ?? {}
      const corpusOverlaps = ['pages', 'doubtMessages', 'sourceChunks'].map((corpus) =>
        overlapRatio(
          Array.isArray(baseline[corpus]) ? baseline[corpus].map(String) : [],
          Array.isArray(hybrid[corpus]) ? hybrid[corpus].map(String) : [],
        )).filter((value): value is number => value !== null)
      return corpusOverlaps.length
        ? corpusOverlaps.reduce((sum, value) => sum + value, 0) / corpusOverlaps.length
        : null
    }).filter((value): value is number => value !== null)
    const durations = workflowTraces
      .map((trace) => Number(trace.duration_ms))
      .filter((value) => Number.isFinite(value))

    return [workflow, {
      samples: overlaps.length,
      averageOverlap: overlaps.length
        ? overlaps.reduce((sum, value) => sum + value, 0) / overlaps.length
        : null,
      degradedRate: workflowTraces.length
        ? workflowTraces.filter((trace) => trace.status === 'degraded').length / workflowTraces.length
        : null,
      averageDurationMs: durations.length
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : null,
    }]
  }))
}

export function allWorkflowsOnV2(config: RetrievalCutoverConfig) {
  return RETRIEVAL_CUTOVER_WORKFLOWS.every(
    (workflow) => config.workflows[workflow].mode === 'v2',
  )
}
