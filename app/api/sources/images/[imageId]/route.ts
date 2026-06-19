// Serve a source-extracted image asset by id. Streams bytes from GridFS.
// Access is scoped to the owning user; images are immutable so we cache hard.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { GridFSBucket, ObjectId } from 'mongodb'
import { getDb } from '@/lib/db'
import { getRequiredUserId } from '@/lib/server/currentUser'

const SOURCE_IMAGE_BUCKET = 'sourceImageObjects'

export async function GET(
  _request: Request,
  { params }: { params: { imageId: string } },
) {
  try {
    const userId = await getRequiredUserId()
    const { imageId } = params

    const db = await getDb()
    const image = await db.collection('sourceImages').findOne({ _id: imageId as any, user_id: userId })
    if (!image || !image.object_id) {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 })
    }

    const bucket = new GridFSBucket(db, { bucketName: SOURCE_IMAGE_BUCKET })
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = bucket.openDownloadStream(new ObjectId(String(image.object_id)))
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      stream.once('error', reject)
      stream.once('end', resolve)
    })
    const bytes = Buffer.concat(chunks)

    return new NextResponse(bytes as any, {
      status: 200,
      headers: {
        'Content-Type': String(image.mime ?? 'image/jpeg'),
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.includes('sign in') ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
