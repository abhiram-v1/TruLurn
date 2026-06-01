import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

const VECTOR_COLLECTIONS = [
  { collection: 'pages', index: 'pages_vector_index' },
  { collection: 'doubtMessages', index: 'doubt_messages_vector_index' },
  { collection: 'sourceChunks', index: 'source_chunks_vector_index' },
] as const

export async function GET() {
  try {
    const db = await getDb()
    const userId = await getRequiredUserId()
    const courses = await db.collection('courses')
      .find({ user_id: userId })
      .project({ _id: 1 })
      .toArray()
    const courseIds = courses.map((course) => String(course._id))

    const collections = await Promise.all(
      VECTOR_COLLECTIONS.map(async ({ collection, index }) => {
        const mongoCollection = db.collection(collection)
        const [indexes, total, embedded] = await Promise.all([
          mongoCollection.listSearchIndexes(index).toArray().catch(() => []),
          courseIds.length
            ? mongoCollection.countDocuments({ course_id: { $in: courseIds } })
            : Promise.resolve(0),
          courseIds.length
            ? mongoCollection.countDocuments({
                course_id: { $in: courseIds },
                embedding: { $exists: true, $type: 'array' },
              })
            : Promise.resolve(0),
        ])

        return {
          collection,
          index,
          indexReady: indexes.length > 0,
          total,
          embedded,
          missingEmbeddings: Math.max(0, total - embedded),
        }
      }),
    )

    return NextResponse.json({
      ok: true,
      courseCount: courseIds.length,
      collections,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown vector status error'
    const status = message.includes('sign in') ? 401 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
