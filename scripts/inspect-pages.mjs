import fs from 'node:fs'
import { MongoClient } from 'mongodb'

const env = fs.readFileSync('.env.local', 'utf8')
for (const line of env.split(/\r?\n/)) {
  const index = line.indexOf('=')
  if (index <= 0) continue
  const key = line.slice(0, index)
  const value = line.slice(index + 1).replace(/^["']|["']$/g, '')
  process.env[key] ??= value
}

const client = new MongoClient(process.env.MONGODB_URI)
await client.connect()

try {
  const db = client.db('trulurn')
  const pages = await db.collection('pages')
    .find({})
    .sort({ created_at: -1 })
    .limit(30)
    .toArray()

  for (const page of pages) {
    console.log(JSON.stringify({
      id: String(page._id),
      course_id: page.course_id,
      topic_id: page.topic_id,
      page_number: page.page_number,
      content_len: String(page.content ?? '').length,
      depth: page.topic_depth,
      section_count: Array.isArray(page.sections) ? page.sections.length : 0,
      sections: Array.isArray(page.sections)
        ? page.sections.map((section) => ({
            type: section.type,
            len: String(section.content ?? '').length,
            preview: String(section.content ?? '').slice(0, 90),
          }))
        : null,
      created_at: page.created_at,
    }))
  }
} finally {
  await client.close()
}
