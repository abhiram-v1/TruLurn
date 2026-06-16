// Aligns Atlas search indexes with the names the current code queries.
//
// Context: Atlas M0/free allows only 3 search indexes per cluster. Legacy
// indexes (pages_vector_index, source_chunks_vector_index,
// doubt_messages_vector_index) occupy all 3 slots, but the code now queries
// *_vector_index_v2_<dims>. We drop the legacy ones and recreate under the
// current names. On M0 there is no room for the separate lexical indexes, so
// retrieval runs dense-only (hybridRank tolerates empty lexical) until a paid
// tier (M10+) frees more index slots.
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'

function loadEnv() {
  const env = {}
  for (const file of ['.env.local', '.env.development.local']) {
    try {
      const raw = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
        if (m) env[m[1]] = m[2].trim()
      }
    } catch {}
  }
  return env
}
const env = loadEnv()
const PROVIDER = env.AI_FEATURE_EMBEDDINGS_PROVIDER || env.AI_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : 'gemini')
const DIMS = Number(env.AI_FEATURE_EMBEDDINGS_DIMENSIONS
  || (PROVIDER === 'openai' ? env.OPENAI_EMBEDDING_DIMENSIONS || 768 : env.GEMINI_EMBEDDING_DIMENSIONS || 768))

const vectorField = { type: 'vector', path: 'embedding', numDimensions: DIMS, similarity: 'cosine' }
// M0 allows only 3 search indexes cluster-wide. Lesson generation needs `pages`
// plus BOTH source collections (legacy courses use `sourceChunks`, durable-
// ingestion courses use `sourcePassages`) — that is the full budget. The
// `doubtMessages` vector index is sacrificed: prior-doubt semantic recall
// degrades gracefully (findRelevantDoubtMessages just returns []), whereas a
// missing source index hard-blocks source-grounded course generation.
// Move to M10+ to restore doubtMessages + the lexical (hybrid) indexes.
const TARGETS = [
  { collection: 'pages', name: `pages_vector_index_v2_${DIMS}`, fields: [vectorField,
    { type: 'filter', path: 'course_id' }, { type: 'filter', path: 'topic_id' }, { type: 'filter', path: 'user_id' }, { type: 'filter', path: 'embedding_version' }] },
  { collection: 'sourceChunks', name: `source_chunks_vector_index_v2_${DIMS}`, fields: [vectorField,
    { type: 'filter', path: 'course_id' }, { type: 'filter', path: 'topic_id' }, { type: 'filter', path: 'user_id' }, { type: 'filter', path: 'embedding_version' }] },
  { collection: 'sourcePassages', name: `source_passages_vector_index_v2_${DIMS}`, fields: [vectorField,
    { type: 'filter', path: 'course_id' }, { type: 'filter', path: 'topic_id' }, { type: 'filter', path: 'user_id' }, { type: 'filter', path: 'source_document_id' }, { type: 'filter', path: 'source_version_id' }, { type: 'filter', path: 'embedding_version' }] },
]
const COLLECTIONS = ['pages', 'sourceChunks', 'doubtMessages', 'sourcePassages']
const wantedNames = new Set(TARGETS.map((t) => t.name))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
try {
  await client.connect()
  const db = client.db()

  // Phase 1: drop every search index that isn't one of our targets.
  console.log('Dropping legacy / unwanted search indexes...')
  for (const coll of COLLECTIONS) {
    const existing = await db.collection(coll).listSearchIndexes().toArray().catch(() => [])
    for (const idx of existing) {
      if (wantedNames.has(idx.name)) continue
      await db.collection(coll).dropSearchIndex(idx.name).catch((e) => console.log(`  drop ${idx.name}: ${e.message}`))
      console.log(`  dropped ${coll}.${idx.name}`)
    }
  }

  // Phase 2: wait for slots to free (drops are async on Atlas).
  console.log('Waiting for index slots to free...')
  for (let i = 0; i < 30; i++) {
    let lingering = 0
    for (const coll of COLLECTIONS) {
      const existing = await db.collection(coll).listSearchIndexes().toArray().catch(() => [])
      lingering += existing.filter((idx) => !wantedNames.has(idx.name)).length
    }
    if (!lingering) break
    await sleep(3000)
  }

  // Phase 3: create the target vector indexes.
  console.log('Creating current-named vector indexes...')
  for (const t of TARGETS) {
    const existing = await db.collection(t.collection).listSearchIndexes(t.name).toArray().catch(() => [])
    if (existing.length) { console.log(`  ${t.name}: already exists`); continue }
    try {
      await db.command({ createSearchIndexes: t.collection, indexes: [{ name: t.name, type: 'vectorSearch', definition: { fields: t.fields } }] })
      console.log(`  ${t.name}: CREATED`)
    } catch (e) {
      console.log(`  ${t.name}: ERROR ${e.message}`)
    }
  }

  console.log('\nDone. Indexes build asynchronously (usually < 1 min on small data).')
  console.log('Note: M0 has no slots left for lexical indexes — retrieval is dense-only until M10+.')
} catch (err) {
  console.error(`FATAL: ${err?.name}: ${err?.message?.split('\n')[0]}`)
  process.exit(1)
} finally {
  await client.close().catch(() => {})
}
