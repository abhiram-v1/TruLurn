const fs = require('fs')
const { MongoClient } = require('mongodb')

function loadEnvLocal() {
  const env = {}
  if (!fs.existsSync('.env.local')) return env

  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const i = trimmed.indexOf('=')
    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function main() {
  const env = { ...process.env, ...loadEnvLocal() }
  const uri = env.MONGODB_URI || env.MONGODB_URL
  const dbName = env.MONGODB_DB || env.MONGODB_DATABASE || 'trulurn'

  if (!uri) {
    throw new Error('Missing MONGODB_URI in .env.local')
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await client.connect()
  const db = client.db(dbName)

  const collections = [
    'courses',
    'branches',
    'topics',
    'topicEdges',
    'pages',
    'pageSummaries',
    'quizQuestions',
    'quizAttempts',
    'doubtMessages',
  ]

  console.log('Agent live smoke: MongoDB connected')
  for (const name of collections) {
    const count = await db.collection(name).countDocuments().catch(() => -1)
    console.log(`${name}: ${count}`)
  }

  const course = await db.collection('courses').findOne({}, { projection: { _id: 1, title: 1, topic: 1, user_id: 1 } })
  if (course) {
    const courseId = String(course._id)
    const [topic, page, attempt] = await Promise.all([
      db.collection('topics').findOne({ course_id: courseId }, { projection: { _id: 1, title: 1, state: 1 } }),
      db.collection('pages').findOne({ course_id: courseId }, { projection: { _id: 1, topic_id: 1, page_number: 1 } }),
      db.collection('quizAttempts').findOne({ course_id: courseId }, { projection: { _id: 1, topic_id: 1, passed: 1 } }),
    ])

    console.log(`sampleCourse: ${course.title || course.topic || courseId}`)
    console.log(`sampleTopic: ${topic ? `${topic.title} (${topic.state})` : 'none'}`)
    console.log(`samplePage: ${page ? `topic ${page.topic_id}, page ${page.page_number}` : 'none'}`)
    console.log(`sampleQuizAttempt: ${attempt ? `${attempt.topic_id} (${attempt.passed ? 'passed' : 'review'})` : 'none'}`)
  }

  await client.close()
}

main().catch((error) => {
  console.error(`${error.name}: ${error.message}`)
  process.exit(1)
})
