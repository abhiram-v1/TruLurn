// Read-only database inventory for estimating TruLurn AI-credit activity.
// It reports aggregate counts and field names only; lesson/chat content is never printed.
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'

function loadEnvFile(name) {
  try {
    const raw = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match || process.env[match[1]]) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[match[1]] = value
    }
  } catch {
    // Optional env files.
  }
}

for (const file of ['.env.local', '.env.development.local', '.env']) loadEnvFile(file)

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error('MONGODB_URI is not configured.')
  process.exit(2)
}

const DAY_MS = 24 * 60 * 60 * 1000
const now = new Date()
const windows = {
  all: null,
  d7: new Date(now.getTime() - 7 * DAY_MS),
  d30: new Date(now.getTime() - 30 * DAY_MS),
}

const candidateCollections = [
  'courses',
  'generationJobs',
  'courseResearchReports',
  'topics',
  'pages',
  'pageSummaries',
  'doubtMessages',
  'retrievalTraces',
  'examSessions',
  'examTurns',
  'quizAttempts',
  'recallSessions',
  'studySessions',
  'sourceDocuments',
  'sourceDocumentVersions',
  'sourceChunks',
  'sourcePassages',
  'learnerMemories',
  'learnerProfiles',
  'learningEvents',
  'aiUsageEvents',
]

function dateFilter(dateField, since) {
  return since ? { [dateField]: { $gte: since } } : {}
}

function redactError(value) {
  return String(value ?? '')
    .replace(/(?:sk-|AIza)[A-Za-z0-9_-]{12,}/g, '[redacted-key]')
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted-mongodb-uri]')
    .slice(0, 500)
}

async function findDateField(collection) {
  const sample = await collection.findOne(
    {},
    {
      projection: {
        created_at: 1,
        updated_at: 1,
        generated_at: 1,
        started_at: 1,
        completed_at: 1,
      },
    },
  )
  if (!sample) return null
  return ['created_at', 'updated_at', 'generated_at', 'started_at', 'completed_at']
    .find((field) => sample[field] instanceof Date) ?? null
}

async function grouped(collection, field, match = {}) {
  const rows = await collection.aggregate([
    { $match: { ...match, [field]: { $exists: true } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]).toArray()
  return Object.fromEntries(rows.map((row) => [String(row._id), row.count]))
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 })
try {
  await client.connect()
  const db = client.db()
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name))
  const report = {
    generated_at: now.toISOString(),
    database: db.databaseName,
    collections: {},
    distributions: {},
    derived: {},
  }

  for (const name of candidateCollections) {
    if (!existing.has(name)) continue
    const collection = db.collection(name)
    const dateField = await findDateField(collection)
    const counts = {}
    for (const [label, since] of Object.entries(windows)) {
      counts[label] = since && !dateField
        ? null
        : await collection.countDocuments(dateFilter(dateField, since))
    }
    const sample = await collection.findOne({}, { projection: { embedding: 0, content: 0, text: 0 } })
    report.collections[name] = {
      date_field: dateField,
      counts,
      fields: sample ? Object.keys(sample).sort() : [],
    }
  }

  const distributions = [
    ['courses', 'mode'],
    ['courses', 'status'],
    ['generationJobs', 'status'],
    ['pages', 'generation_status'],
    ['pages', 'generation_source'],
    ['pages', 'grounding.status'],
    ['doubtMessages', 'role'],
    ['doubtMessages', 'question_type'],
    ['retrievalTraces', 'workflow'],
    ['retrievalTraces', 'status'],
    ['examSessions', 'status'],
    ['examTurns', 'status'],
    ['examTurns', 'source'],
    ['recallSessions', 'status'],
    ['sourceChunks', 'embedding_status'],
    ['sourcePassages', 'embedding_status'],
    ['learningEvents', 'event_type'],
    ['aiUsageEvents', 'feature'],
    ['aiUsageEvents', 'status'],
  ]

  for (const [collectionName, field] of distributions) {
    if (!existing.has(collectionName)) continue
    report.distributions[`${collectionName}.${field}`] = await grouped(
      db.collection(collectionName),
      field,
    )
  }

  const sevenDaysAgo = windows.d7
  if (existing.has('generationJobs')) {
    report.derived.generation_jobs = await db.collection('generationJobs').aggregate([
      { $match: { created_at: { $gte: sevenDaysAgo } } },
      {
        $project: {
          status: 1,
          stage: 1,
          completed_stages: { $ifNull: ['$completed_stages', []] },
          has_research: { $ne: [{ $ifNull: ['$researchReport', null] }, null] },
          has_curriculum: { $ne: [{ $ifNull: ['$curriculum', null] }, null] },
          has_map: { $ne: [{ $ifNull: ['$map', null] }, null] },
          has_audience: { $ne: [{ $ifNull: ['$learnerAudience', null] }, null] },
        },
      },
      {
        $group: {
          _id: { status: '$status', stage: '$stage' },
          jobs: { $sum: 1 },
          completed_stage_total: { $sum: { $size: '$completed_stages' } },
          research_outputs: { $sum: { $cond: ['$has_research', 1, 0] } },
          curriculum_outputs: { $sum: { $cond: ['$has_curriculum', 1, 0] } },
          map_outputs: { $sum: { $cond: ['$has_map', 1, 0] } },
          audience_outputs: { $sum: { $cond: ['$has_audience', 1, 0] } },
        },
      },
      { $sort: { '_id.status': 1, '_id.stage': 1 } },
    ]).toArray()
    report.derived.generation_job_failures = (
      await db.collection('generationJobs')
        .find(
          { created_at: { $gte: sevenDaysAgo }, status: 'failed' },
          { projection: { _id: 0, stage: 1, error: 1, error_code: 1 } },
        )
        .toArray()
    ).map((failure) => ({
      stage: failure.stage,
      error_code: failure.error_code ?? null,
      error: redactError(failure.error),
    }))
  }

  if (existing.has('topics')) {
    report.derived.topic_plans = {
      total: await db.collection('topics').countDocuments({ lesson_plan: { $exists: true, $ne: null } }),
      updated_d7: await db.collection('topics').countDocuments({
        lesson_plan: { $exists: true, $ne: null },
        updated_at: { $gte: sevenDaysAgo },
      }),
    }
  }

  if (existing.has('pages')) {
    report.derived.pages = {
      created_d7: await db.collection('pages').countDocuments({ created_at: { $gte: sevenDaysAgo } }),
      embedded_d7: await db.collection('pages').countDocuments({
        created_at: { $gte: sevenDaysAgo },
        embedding_status: 'ready',
      }),
      grounded_d7: await db.collection('pages').countDocuments({
        created_at: { $gte: sevenDaysAgo },
        grounding: { $exists: true, $ne: null },
      }),
      repaired_d7: await db.collection('pages').countDocuments({
        created_at: { $gte: sevenDaysAgo },
        'quality_repair_history.0': { $exists: true },
      }),
    }
  }

  if (existing.has('learningEvents')) {
    report.derived.lesson_generation_events_d7 = await grouped(
      db.collection('learningEvents'),
      'event_type',
      { created_at: { $gte: sevenDaysAgo } },
    )
  }

  if (existing.has('examTurns')) {
    report.derived.exam_turns = {
      generated_d7: await db.collection('examTurns').countDocuments({ created_at: { $gte: sevenDaysAgo } }),
      evaluated_d7: await db.collection('examTurns').countDocuments({ evaluated_at: { $gte: sevenDaysAgo } }),
    }
  }

  if (existing.has('retrievalTraces')) {
    report.derived.retrieval = await db.collection('retrievalTraces').aggregate([
      { $match: { created_at: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: '$workflow',
          runs: { $sum: 1 },
          avg_duration_ms: { $avg: '$duration_ms' },
          max_duration_ms: { $max: '$duration_ms' },
          errored_runs: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$errors', []] } }, 0] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]).toArray()
  }

  if (existing.has('aiUsageEvents')) {
    report.derived.ai_usage = await db.collection('aiUsageEvents').aggregate([
      { $match: { created_at: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: {
            feature: '$feature',
            provider: '$provider',
            model: '$model',
            operation: '$operation',
            status: '$status',
          },
          calls: { $sum: 1 },
          input_tokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
          cached_input_tokens: { $sum: { $ifNull: ['$cached_input_tokens', 0] } },
          output_tokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
          estimated_input_tokens: { $sum: { $ifNull: ['$estimated_input_tokens', 0] } },
          avg_duration_ms: { $avg: '$duration_ms' },
        },
      },
      { $sort: { calls: -1 } },
    ]).toArray()
  }

  console.log(JSON.stringify(report, null, 2))
} finally {
  await client.close()
}
