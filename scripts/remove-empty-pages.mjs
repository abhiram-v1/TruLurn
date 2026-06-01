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

function isBlankGeneratedPage(page) {
  const content = String(page?.content ?? '').trim()
  const sectionContent = Array.isArray(page?.sections)
    ? page.sections.map((section) => String(section?.content ?? '').trim()).join('')
    : ''

  return content.length < 60 && sectionContent.length < 60
}

const client = new MongoClient(process.env.MONGODB_URI)
await client.connect()

try {
  const db = client.db('trulurn')
  const pages = await db.collection('pages').find({}).toArray()
  const blankPages = pages.filter(isBlankGeneratedPage)

  if (!blankPages.length) {
    console.log('No empty generated pages found.')
    process.exit(0)
  }

  for (const page of blankPages) {
    await Promise.all([
      db.collection('pages').deleteOne({ _id: page._id }),
      db.collection('pageSummaries').deleteMany({ page_id: String(page._id) }),
    ])

    console.log(`removed empty page ${String(page._id)} topic=${page.topic_id} page=${page.page_number}`)
  }

  console.log(`Done. Removed ${blankPages.length} empty generated page(s). Valid pages were kept.`)
} finally {
  await client.close()
}
