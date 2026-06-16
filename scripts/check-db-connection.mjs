// Minimal Atlas connectivity probe. Reads MONGODB_URI from .env.local and pings.
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'

function readEnv(key) {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && m[1] === key) return m[2].trim()
  }
  return null
}

const uri = readEnv('MONGODB_URI')
if (!uri) { console.error('MONGODB_URI not found in .env.local'); process.exit(2) }

const started = Date.now()
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
try {
  await client.connect()
  const admin = client.db().admin()
  await admin.ping()
  console.log(`PING OK in ${Date.now() - started}ms`)
} catch (err) {
  console.error(`PING FAILED in ${Date.now() - started}ms`)
  console.error(`${err?.name}: ${err?.message?.split('\n')[0]}`)
  process.exit(1)
} finally {
  await client.close().catch(() => {})
}
