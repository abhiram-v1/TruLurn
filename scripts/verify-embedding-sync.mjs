// Reports whether stored embeddings match the embedding_version the app would
// use right now. A mismatch (or absence) means RAG silently retrieves nothing.
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
const provider = env.AI_FEATURE_EMBEDDINGS_PROVIDER || env.AI_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : 'gemini')
const model = env.AI_FEATURE_EMBEDDINGS_MODEL
  || (provider === 'openai' ? env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
                            : env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001')
const dims = Number(env.AI_FEATURE_EMBEDDINGS_DIMENSIONS
  || (provider === 'openai' ? env.OPENAI_EMBEDDING_DIMENSIONS || 768
                            : env.GEMINI_EMBEDDING_DIMENSIONS || 768))
const ACTIVE = ['rag-v2', provider, model, dims, 'content-v1'].join(':')

console.log(`Active embedding_version the app expects:\n  ${ACTIVE}\n`)

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
try {
  await client.connect()
  const db = client.db()
  for (const coll of ['pages', 'sourceChunks', 'sourcePassages', 'doubtMessages']) {
    const c = db.collection(coll)
    const total = await c.countDocuments()
    if (!total) { console.log(`${coll}: (empty)\n`); continue }
    const withEmbedding = await c.countDocuments({ embedding: { $exists: true, $ne: null } })
    const inSync = await c.countDocuments({ embedding_version: ACTIVE })
    const status = await c.aggregate([
      { $group: { _id: '$embedding_status', n: { $sum: 1 } } }, { $sort: { n: -1 } },
    ]).toArray()
    let indexes = []
    try { indexes = await c.listSearchIndexes().toArray() } catch {}
    console.log(`${coll}: ${total} docs | has embedding vector: ${withEmbedding} | in-sync version: ${inSync}`)
    console.log(`  embedding_status: ${status.map((s) => `${s._id ?? '(none)'}=${s.n}`).join(', ')}`)
    console.log(`  Atlas search indexes: ${indexes.length ? indexes.map((i) => `${i.name}[${i.status ?? i.queryable}]`).join(', ') : 'NONE'}\n`)
  }
} catch (err) {
  console.error(`FAILED: ${err?.name}: ${err?.message?.split('\n')[0]}`)
  process.exit(1)
} finally {
  await client.close().catch(() => {})
}
