import fs from 'node:fs'
import path from 'node:path'
import { MongoClient } from 'mongodb'

const cwd = process.cwd()
const envPath = path.join(cwd, '.env.local')

if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8')
  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    const rawValue = trimmed.slice(eq + 1)
    process.env[key] ??= rawValue.replace(/^["']|["']$/g, '')
  }
}

const uri = process.env.MONGODB_URI
const provider = (
  process.env.AI_FEATURE_EMBEDDINGS_PROVIDER
  ?? process.env.AI_PROVIDER
  ?? (process.env.OPENAI_API_KEY ? 'openai' : 'gemini')
).toLowerCase()
const apiKey = provider === 'openai'
  ? process.env.OPENAI_API_KEY
  : process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
const embeddingModel = provider === 'openai'
  ? process.env.AI_FEATURE_EMBEDDINGS_MODEL ?? process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small'
  : process.env.AI_FEATURE_EMBEDDINGS_MODEL ?? process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001'
const dimensions = provider === 'openai'
  ? Number(process.env.AI_FEATURE_EMBEDDINGS_DIMENSIONS ?? process.env.OPENAI_EMBEDDING_DIMENSIONS ?? 768)
  : Number(process.env.AI_FEATURE_EMBEDDINGS_DIMENSIONS ?? process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768)
const embeddingVersion = `rag-v2:${provider}:${embeddingModel}:${dimensions}:content-v1`

if (!uri) throw new Error('Missing MONGODB_URI in .env.local')
if (!apiKey) throw new Error(`Missing ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY'} in .env.local`)

function normalize(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  return magnitude ? values.map((value) => value / magnitude) : values
}

function formatInput(text, taskType) {
  const cleanText = text.replace(/\s+/g, ' ').trim()
  if (!embeddingModel.includes('embedding-2')) return cleanText
  if (taskType === 'RETRIEVAL_QUERY' || taskType === 'QUESTION_ANSWERING') {
    return `task: question answering | query: ${cleanText}`
  }
  if (taskType === 'RETRIEVAL_DOCUMENT') {
    return `title: TruLurn lesson memory | text: ${cleanText}`
  }
  return `task: sentence similarity | query: ${cleanText}`
}

async function embedText(text, taskType = 'SEMANTIC_SIMILARITY') {
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: text.replace(/\s+/g, ' ').trim().slice(0, 16000),
        dimensions,
      }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message ?? `OpenAI embedding failed: ${response.status}`)
    }

    const values = data.data?.[0]?.embedding
    if (!values?.length) throw new Error('OpenAI returned an empty embedding.')
    return values
  }

  const body = {
    content: {
      parts: [{ text: formatInput(text, taskType).slice(0, 16000) }],
    },
    output_dimensionality: dimensions,
  }

  if (!embeddingModel.includes('embedding-2')) {
    body.taskType = taskType
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${embeddingModel}:embedContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
  )
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Gemini embedding failed: ${response.status}`)
  }

  const values = data.embedding?.values ?? data.embeddings?.[0]?.values
  if (!values?.length) throw new Error('Gemini returned an empty embedding.')

  return embeddingModel.includes('embedding-2') ? values : normalize(values)
}

const vectorIndexes = [
  {
    collection: 'pages',
    name: `pages_vector_index_v2_${dimensions}`,
    filters: ['course_id', 'topic_id', 'user_id', 'embedding_version'],
  },
  {
    collection: 'doubtMessages',
    name: `doubt_messages_vector_index_v2_${dimensions}`,
    filters: ['course_id', 'user_id', 'topic_id', 'role', 'embedding_version'],
  },
  {
    collection: 'sourceChunks',
    name: `source_chunks_vector_index_v2_${dimensions}`,
    filters: ['course_id', 'topic_id', 'user_id', 'embedding_version'],
  },
  {
    collection: 'sourcePassages',
    name: `source_passages_vector_index_v2_${dimensions}`,
    filters: [
      'course_id',
      'topic_id',
      'user_id',
      'source_document_id',
      'source_version_id',
      'embedding_version',
    ],
  },
]

const lexicalIndexes = [
  {
    collection: 'pages',
    name: 'pages_lexical_index_v1',
    stringFields: ['content', 'focus', 'summary'],
    tokenFields: ['course_id', 'user_id', 'topic_id', 'embedding_version'],
  },
  {
    collection: 'doubtMessages',
    name: 'doubt_messages_lexical_index_v1',
    stringFields: ['content'],
    tokenFields: ['course_id', 'user_id', 'topic_id', 'role', 'embedding_version'],
  },
  ...['sourceChunks', 'sourcePassages'].map((collection) => ({
    collection,
    name: collection === 'sourceChunks'
      ? 'source_chunks_lexical_index_v1'
      : 'source_passages_lexical_index_v1',
    stringFields: ['content', 'source_title', 'heading_path'],
    tokenFields: [
      'course_id',
      'user_id',
      'topic_id',
      'source_document_id',
      'source_version_id',
      'embedding_version',
    ],
  })),
]

async function ensureIndexes(db) {
  for (const item of vectorIndexes) {
    const collections = await db.listCollections({ name: item.collection }).toArray()
    if (!collections.length) {
      await db.createCollection(item.collection)
      console.log(`created collection ${item.collection}`)
    }

    const collection = db.collection(item.collection)
    const existing = await collection.listSearchIndexes(item.name).toArray().catch(() => [])
    if (existing.length) {
      console.log(`exists  ${item.collection}.${item.name}`)
      continue
    }

    await db.command({
      createSearchIndexes: item.collection,
      indexes: [
        {
          name: item.name,
          type: 'vectorSearch',
          definition: {
            fields: [
              {
                type: 'vector',
                path: 'embedding',
                numDimensions: dimensions,
                similarity: 'cosine',
              },
              ...item.filters.map((filter) => ({ type: 'filter', path: filter })),
            ],
          },
        },
      ],
    })
    console.log(`created ${item.collection}.${item.name}`)
  }

  for (const item of lexicalIndexes) {
    const collections = await db.listCollections({ name: item.collection }).toArray()
    if (!collections.length) {
      await db.createCollection(item.collection)
      console.log(`created collection ${item.collection}`)
    }

    const collection = db.collection(item.collection)
    const existing = await collection.listSearchIndexes(item.name).toArray().catch(() => [])
    if (existing.length) {
      console.log(`exists  ${item.collection}.${item.name}`)
      continue
    }

    const fields = {}
    for (const field of item.stringFields) {
      fields[field] = { type: 'string', analyzer: 'lucene.standard' }
    }
    for (const field of item.tokenFields) {
      fields[field] = { type: 'token' }
    }

    await db.command({
      createSearchIndexes: item.collection,
      indexes: [
        {
          name: item.name,
          type: 'search',
          definition: {
            mappings: {
              dynamic: false,
              fields,
            },
          },
        },
      ],
    })
    console.log(`created ${item.collection}.${item.name}`)
  }
}

async function embedPages(db) {
  const pages = await db.collection('pages')
    .find({ embedding_version: { $ne: embeddingVersion } })
    .limit(500)
    .toArray()

  let count = 0
  for (const page of pages) {
    const [topic, summary] = await Promise.all([
      db.collection('topics').findOne({ _id: page.topic_id, course_id: page.course_id }),
      db.collection('pageSummaries').findOne({ page_id: String(page._id), course_id: page.course_id }),
    ])

    const text = [
      `Topic: ${topic?.title ?? page.topic_id}`,
      summary?.focus ? `Focus: ${summary.focus}` : null,
      summary?.summary ? `Summary: ${summary.summary}` : null,
      Array.isArray(summary?.key_concepts) ? `Key concepts: ${summary.key_concepts.join(', ')}` : null,
      `Content: ${page.content}`,
    ].filter(Boolean).join('\n')

    const embedding = await embedText(text, 'RETRIEVAL_DOCUMENT')
    await db.collection('pages').updateOne(
      { _id: page._id },
      {
        $set: {
          embedding,
          embedding_provider: provider,
          embedding_model: embeddingModel,
          embedding_dimensions: dimensions,
          embedding_version: embeddingVersion,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
    count += 1
    console.log(`embedded page ${count}/${pages.length}`)
  }
  return count
}

async function embedDoubtMessages(db) {
  const messages = await db.collection('doubtMessages')
    .find({ role: 'user', embedding_version: { $ne: embeddingVersion } })
    .limit(500)
    .toArray()

  let count = 0
  for (const message of messages) {
    const topic = await db.collection('topics').findOne({
      _id: message.topic_id,
      course_id: message.course_id,
    })
    const text = [
      `Role: ${message.role}`,
      topic?.title ? `Topic: ${topic.title}` : null,
      message.page_number ? `Page: ${message.page_number}` : null,
      message.content,
    ].filter(Boolean).join('\n')

    const embedding = await embedText(text, 'RETRIEVAL_DOCUMENT')
    await db.collection('doubtMessages').updateOne(
      { _id: message._id },
      {
        $set: {
          embedding,
          retrieval_eligible: true,
          embedding_provider: provider,
          embedding_model: embeddingModel,
          embedding_dimensions: dimensions,
          embedding_version: embeddingVersion,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
    count += 1
    console.log(`embedded doubt message ${count}/${messages.length}`)
  }
  return count
}

async function embedSourceChunks(db) {
  const chunks = await db.collection('sourceChunks')
    .find({ embedding_version: { $ne: embeddingVersion } })
    .limit(500)
    .toArray()

  let count = 0
  for (const chunk of chunks) {
    const text = [
      chunk.source_title ? `Source: ${chunk.source_title}` : null,
      chunk.topic_title ? `Topic: ${chunk.topic_title}` : null,
      chunk.summary ? `Summary: ${chunk.summary}` : null,
      chunk.content ?? chunk.text ?? chunk.chunk_text,
    ].filter(Boolean).join('\n')

    if (!text.trim()) continue

    const embedding = await embedText(text, 'RETRIEVAL_DOCUMENT')
    await db.collection('sourceChunks').updateOne(
      { _id: chunk._id },
      {
        $set: {
          embedding,
          embedding_provider: provider,
          embedding_model: embeddingModel,
          embedding_dimensions: dimensions,
          embedding_version: embeddingVersion,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
    count += 1
    console.log(`embedded source chunk ${count}/${chunks.length}`)
  }
  return count
}

async function embedSourcePassages(db) {
  const passages = await db.collection('sourcePassages')
    .find({ embedding_version: { $ne: embeddingVersion } })
    .limit(500)
    .toArray()

  let count = 0
  for (const passage of passages) {
    const text = [
      passage.source_title ? `Source: ${passage.source_title}` : null,
      Array.isArray(passage.heading_path) && passage.heading_path.length
        ? `Section: ${passage.heading_path.join(' > ')}`
        : null,
      passage.content,
    ].filter(Boolean).join('\n')

    if (!text.trim()) continue

    const embedding = await embedText(text, 'RETRIEVAL_DOCUMENT')
    await db.collection('sourcePassages').updateOne(
      { _id: passage._id },
      {
        $set: {
          embedding,
          embedding_provider: provider,
          embedding_model: embeddingModel,
          embedding_dimensions: dimensions,
          embedding_version: embeddingVersion,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
    count += 1
    console.log(`embedded source passage ${count}/${passages.length}`)
  }
  return count
}

const client = new MongoClient(uri)
await client.connect()

try {
  const db = client.db('trulurn')
  console.log(`Using ${embeddingVersion}`)
  await ensureIndexes(db)
  const pages = await embedPages(db)
  const doubtMessages = await embedDoubtMessages(db)
  const sourceChunks = await embedSourceChunks(db)
  const sourcePassages = await embedSourcePassages(db)
  console.log(`Done. Embedded ${pages} pages, ${doubtMessages} doubt messages, ${sourceChunks} source chunks, and ${sourcePassages} source passages.`)
} finally {
  await client.close()
}
