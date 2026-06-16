import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'

function readEnv(key) {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (match?.[1] === key) return match[2].trim()
  }
  return null
}

const uri = readEnv('MONGODB_URI')
if (!uri) {
  console.error('MONGODB_URI not found in .env.local')
  process.exit(2)
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
const connectStartedAt = performance.now()

try {
  await client.connect()
  const connectedAt = performance.now()
  const admin = client.db().admin()
  const pings = []

  for (let index = 0; index < 5; index += 1) {
    const pingStartedAt = performance.now()
    await admin.ping()
    pings.push(performance.now() - pingStartedAt)
  }

  const sorted = [...pings].sort((left, right) => left - right)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log(`Mongo connect: ${Math.round(connectedAt - connectStartedAt)}ms`)
  console.log(`Mongo warm pings: ${pings.map((value) => `${Math.round(value)}ms`).join(', ')}`)
  console.log(`Mongo warm median: ${Math.round(median)}ms`)
} catch (error) {
  console.error(`${error?.name}: ${error?.message?.split('\n')[0]}`)
  process.exit(1)
} finally {
  await client.close().catch(() => {})
}
