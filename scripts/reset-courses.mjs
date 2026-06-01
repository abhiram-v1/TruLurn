import fs from 'node:fs'
import path from 'node:path'
import { MongoClient } from 'mongodb'

const cwd = process.cwd()
for (const file of ['.env.local', '.env']) {
  const envPath = path.join(cwd, file)
  if (!fs.existsSync(envPath)) continue

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
if (!uri) throw new Error('Missing MONGODB_URI in .env.local or .env')

const collections = [
  'courses',
  'branches',
  'topics',
  'topicEdges',
  'courseSummaries',
  'topicSummaries',
  'pages',
  'pageSummaries',
  'doubtMessages',
  'quizQuestions',
  'quizAttempts',
  'sourceChunks',
]

const client = new MongoClient(uri)
await client.connect()

try {
  const db = client.db('trulurn')
  for (const collectionName of collections) {
    const result = await db.collection(collectionName).deleteMany({})
    console.log(`${collectionName}: deleted ${result.deletedCount}`)
  }
  console.log('Done. Auth users, sessions, and OAuth accounts were not deleted.')
} finally {
  await client.close()
}
