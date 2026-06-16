/**
 * Upserts a skill pack JSON file into the courseSkillPacks collection.
 *
 * Usage:
 *   node scripts/seed-skill-pack.mjs skill-packs/machine-learning-foundations.json
 *
 * With no argument, seeds all JSON files in the skill-packs/ directory.
 */

import fs from 'node:fs'
import path from 'node:path'
import { MongoClient } from 'mongodb'

const cwd = process.cwd()

for (const file of ['.env.local', '.env']) {
  const envPath = path.join(cwd, file)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    process.env[trimmed.slice(0, eq)] ??= trimmed.slice(eq + 1).replace(/^["']|["']$/g, '')
  }
}

const uri = process.env.MONGODB_URI
if (!uri) throw new Error('Missing MONGODB_URI in .env.local or .env')

const packDir = path.join(cwd, 'skill-packs')
const targets = process.argv[2]
  ? [path.resolve(cwd, process.argv[2])]
  : fs.readdirSync(packDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(packDir, f))

if (!targets.length) {
  console.log('No skill pack files found.')
  process.exit(0)
}

const client = new MongoClient(uri)
await client.connect()

try {
  const db = client.db('trulurn')
  const collection = db.collection('courseSkillPacks')

  for (const filePath of targets) {
    const pack = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!pack.key) {
      console.warn(`Skipping ${filePath} — missing "key" field`)
      continue
    }

    const result = await collection.updateOne(
      { key: pack.key },
      { $set: { ...pack, updated_at: new Date() } },
      { upsert: true },
    )

    const action = result.upsertedCount ? 'inserted' : 'updated'
    console.log(`${action}: ${pack.key} v${pack.version} — ${pack.documents?.length ?? 0} documents`)
  }
} finally {
  await client.close()
}
