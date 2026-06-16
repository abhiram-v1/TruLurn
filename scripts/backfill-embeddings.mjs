// One-time backfill: bring legacy embeddings in sync with the current RAG schema.
//
// It (1) creates the current-named Atlas vector + lexical search indexes and
// (2) re-embeds every doc whose embedding_version != the active version, tagging
// it exactly as the app's lib/vector/retrieval.ts would. Idempotent and safe to
// re-run — already-synced docs are skipped.
//
// Replicates (keep in step with the source if those change):
//   - embedding text builders + write fields: lib/vector/retrieval.ts
//   - index definitions/names:                lib/vector/indexes.ts
//   - active version resolution:              lib/ai/embeddings.ts
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
const MODEL = env.AI_FEATURE_EMBEDDINGS_MODEL
  || (PROVIDER === 'openai' ? env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
                            : env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001')
const DIMS = Number(env.AI_FEATURE_EMBEDDINGS_DIMENSIONS
  || (PROVIDER === 'openai' ? env.OPENAI_EMBEDDING_DIMENSIONS || 768
                            : env.GEMINI_EMBEDDING_DIMENSIONS || 768))
const ACTIVE = ['rag-v2', PROVIDER, MODEL, DIMS, 'content-v1'].join(':')

if (PROVIDER !== 'openai') {
  console.error(`This backfill implements the OpenAI embedding path; active provider is "${PROVIDER}". Aborting to avoid producing mismatched vectors.`)
  process.exit(2)
}
if (!env.OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(2) }

// ── embedding (mirrors lib/ai/openai/embeddings.ts) ──
async function embed(text) {
  const cleanText = String(text).replace(/\s+/g, ' ').trim()
  if (!cleanText) throw new Error('empty text')
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: cleanText.slice(0, 16000), dimensions: DIMS }),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `status ${res.status}`)
  const values = data.data?.[0]?.embedding
  if (!values?.length) throw new Error('empty embedding')
  return values
}

function tagFields(embedding) {
  return {
    embedding,
    embedding_provider: PROVIDER,
    embedding_model: MODEL,
    embedding_dimensions: DIMS,
    embedding_version: ACTIVE,
    embedding_status: 'ready',
    embedding_error: null,
    embedding_updated_at: new Date(),
  }
}

// ── embedding text builders (mirror lib/vector/retrieval.ts) ──
const pageText = (page, topic, summary) => [
  `Topic: ${topic?.title ?? page.topic_title ?? page.topic_id}`,
  summary?.focus ? `Focus: ${summary.focus}` : null,
  summary?.summary ? `Summary: ${summary.summary}` : null,
  Array.isArray(summary?.key_concepts) && summary.key_concepts.length ? `Key concepts: ${summary.key_concepts.join(', ')}` : null,
  `Content: ${page.content}`,
].filter(Boolean).join('\n')

const sourceChunkText = (chunk) => [
  chunk.source_title ? `Source: ${chunk.source_title}` : null,
  chunk.topic_title ? `Topic: ${chunk.topic_title}` : null,
  chunk.summary ? `Summary: ${chunk.summary}` : null,
  chunk.content ?? chunk.text ?? chunk.chunk_text,
].filter(Boolean).join('\n')

const doubtText = (m, topicTitle) => [
  `Role: ${m.role}`,
  topicTitle ? `Topic: ${topicTitle}` : null,
  m.page_number ? `Page: ${m.page_number}` : null,
  m.content,
].filter(Boolean).join('\n')

// ── index definitions (mirror lib/vector/indexes.ts) ──
const vectorField = { type: 'vector', path: 'embedding', numDimensions: DIMS, similarity: 'cosine' }
const VECTOR_INDEXES = [
  { collection: 'pages', name: `pages_vector_index_v2_${DIMS}`, fields: [vectorField,
    { type: 'filter', path: 'course_id' }, { type: 'filter', path: 'topic_id' }, { type: 'filter', path: 'user_id' }, { type: 'filter', path: 'embedding_version' }] },
  { collection: 'doubtMessages', name: `doubt_messages_vector_index_v2_${DIMS}`, fields: [vectorField,
    { type: 'filter', path: 'course_id' }, { type: 'filter', path: 'user_id' }, { type: 'filter', path: 'topic_id' }, { type: 'filter', path: 'role' }, { type: 'filter', path: 'embedding_version' }] },
  { collection: 'sourceChunks', name: `source_chunks_vector_index_v2_${DIMS}`, fields: [vectorField,
    { type: 'filter', path: 'course_id' }, { type: 'filter', path: 'topic_id' }, { type: 'filter', path: 'user_id' }, { type: 'filter', path: 'embedding_version' }] },
  { collection: 'sourcePassages', name: `source_passages_vector_index_v2_${DIMS}`, fields: [vectorField,
    { type: 'filter', path: 'course_id' }, { type: 'filter', path: 'topic_id' }, { type: 'filter', path: 'user_id' }, { type: 'filter', path: 'source_document_id' }, { type: 'filter', path: 'source_version_id' }, { type: 'filter', path: 'embedding_version' }] },
]
const lexicalFields = (extra) => ({
  content: { type: 'string', analyzer: 'lucene.standard' }, ...extra,
  course_id: { type: 'token' }, user_id: { type: 'token' }, topic_id: { type: 'token' }, embedding_version: { type: 'token' },
})
const LEXICAL_INDEXES = [
  { collection: 'pages', name: 'pages_lexical_index_v1', fields: lexicalFields({ focus: { type: 'string', analyzer: 'lucene.standard' }, summary: { type: 'string', analyzer: 'lucene.standard' } }) },
  { collection: 'doubtMessages', name: 'doubt_messages_lexical_index_v1', fields: lexicalFields({ role: { type: 'token' } }) },
  { collection: 'sourceChunks', name: 'source_chunks_lexical_index_v1', fields: lexicalFields({ source_title: { type: 'string', analyzer: 'lucene.standard' }, heading_path: { type: 'string', analyzer: 'lucene.standard' }, source_document_id: { type: 'token' }, source_version_id: { type: 'token' } }) },
  { collection: 'sourcePassages', name: 'source_passages_lexical_index_v1', fields: lexicalFields({ source_title: { type: 'string', analyzer: 'lucene.standard' }, heading_path: { type: 'string', analyzer: 'lucene.standard' }, source_document_id: { type: 'token' }, source_version_id: { type: 'token' } }) },
]

async function ensureIndex(db, { collection, name }, definition, type) {
  const colls = await db.listCollections({ name: collection }).toArray()
  if (!colls.length) await db.createCollection(collection)
  const existing = await db.collection(collection).listSearchIndexes(name).toArray().catch(() => [])
  if (existing.length) { console.log(`  index ${name}: exists`); return }
  await db.command({ createSearchIndexes: collection, indexes: [{ name, type, definition }] })
  console.log(`  index ${name}: CREATED`)
}

console.log(`Active version: ${ACTIVE}\n`)
const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
try {
  await client.connect()
  const db = client.db()

  console.log('Ensuring Atlas search indexes...')
  for (const idx of VECTOR_INDEXES) {
    try { await ensureIndex(db, idx, { fields: idx.fields }, 'vectorSearch') }
    catch (e) { console.log(`  index ${idx.name}: ERROR ${e.message}`) }
  }
  for (const idx of LEXICAL_INDEXES) {
    try { await ensureIndex(db, idx, { mappings: { dynamic: false, fields: idx.fields } }, 'search') }
    catch (e) { console.log(`  index ${idx.name}: ERROR ${e.message}`) }
  }

  const stale = { _id: { $exists: true }, embedding_version: { $ne: ACTIVE } }

  // pages
  let n = 0, fail = 0
  const pages = await db.collection('pages').find(stale).toArray()
  console.log(`\nRe-embedding ${pages.length} pages...`)
  for (const page of pages) {
    try {
      const [topic, summary] = await Promise.all([
        db.collection('topics').findOne({ _id: page.topic_id, course_id: page.course_id }),
        db.collection('pageSummaries').findOne({ page_id: String(page._id), course_id: page.course_id }),
      ])
      const v = await embed(pageText(page, topic, summary))
      await db.collection('pages').updateOne({ _id: page._id }, { $set: tagFields(v) })
      n++
    } catch (e) {
      fail++
      await db.collection('pages').updateOne({ _id: page._id }, { $set: { embedding_status: 'failed', embedding_error: String(e.message), embedding_updated_at: new Date() } })
      console.log(`  page ${page._id} FAILED: ${e.message}`)
    }
  }
  console.log(`  pages: ${n} embedded, ${fail} failed`)

  // sourceChunks
  n = 0; fail = 0
  const chunks = await db.collection('sourceChunks').find(stale).toArray()
  console.log(`\nRe-embedding ${chunks.length} sourceChunks...`)
  for (const chunk of chunks) {
    try {
      const v = await embed(sourceChunkText(chunk))
      await db.collection('sourceChunks').updateOne({ _id: chunk._id }, { $set: tagFields(v) })
      n++
    } catch (e) {
      fail++
      await db.collection('sourceChunks').updateOne({ _id: chunk._id }, { $set: { embedding_status: 'failed', embedding_error: String(e.message), embedding_updated_at: new Date() } })
      console.log(`  chunk ${chunk._id} FAILED: ${e.message}`)
    }
  }
  console.log(`  sourceChunks: ${n} embedded, ${fail} failed`)

  // doubtMessages — only role:'user' is retrieval-eligible; others are excluded
  n = 0; fail = 0; let excluded = 0
  const doubts = await db.collection('doubtMessages').find(stale).toArray()
  console.log(`\nProcessing ${doubts.length} doubtMessages...`)
  for (const m of doubts) {
    if (m.role !== 'user') {
      await db.collection('doubtMessages').updateOne({ _id: m._id }, {
        $set: { retrieval_eligible: false, embedding_status: 'excluded', embedding_error: null },
        $unset: { embedding: '', embedding_provider: '', embedding_model: '', embedding_dimensions: '', embedding_version: '', embedding_updated_at: '' },
      })
      excluded++
      continue
    }
    try {
      const topic = await db.collection('topics').findOne({ _id: m.topic_id, course_id: m.course_id })
      const v = await embed(doubtText(m, topic?.title))
      await db.collection('doubtMessages').updateOne({ _id: m._id }, { $set: { retrieval_eligible: true, ...tagFields(v) } })
      n++
    } catch (e) {
      fail++
      await db.collection('doubtMessages').updateOne({ _id: m._id }, { $set: { embedding_status: 'failed', embedding_error: String(e.message), embedding_updated_at: new Date() } })
      console.log(`  doubt ${m._id} FAILED: ${e.message}`)
    }
  }
  console.log(`  doubtMessages: ${n} embedded, ${excluded} excluded (non-user), ${fail} failed`)

  console.log('\nDone. Atlas indexes build asynchronously — allow a few seconds before they read READY.')
} catch (err) {
  console.error(`FATAL: ${err?.name}: ${err?.message?.split('\n')[0]}`)
  process.exit(1)
} finally {
  await client.close().catch(() => {})
}
