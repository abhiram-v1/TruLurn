import crypto from 'crypto'
import { GridFSBucket, ObjectId, type Db } from 'mongodb'
import {
  extractTextFromSourceFile,
  isRichSource,
  isTextSource,
  type ExtractedSourceImage,
} from '@/lib/ai/sources'
import {
  ACTIVE_EMBEDDING_DIMENSIONS,
  ACTIVE_EMBEDDING_MODEL,
  ACTIVE_EMBEDDING_PROVIDER,
  ACTIVE_EMBEDDING_VERSION,
  embedText,
} from '@/lib/ai/embeddings'

const SOURCE_OBJECT_BUCKET = 'sourceObjects'
const SOURCE_IMAGE_BUCKET = 'sourceImageObjects'
const INGESTION_SCHEMA_VERSION = 'source-ingestion-v1'
const CHUNKER_VERSION = 'structured-passages-v1'
const DEFAULT_MAX_SOURCE_BYTES = 25 * 1024 * 1024
const PASSAGE_TARGET_CHARS = 1800
const PASSAGE_MAX_CHARS = 2600

type CanonicalBlockType = 'heading' | 'paragraph' | 'list' | 'table' | 'code'

type CanonicalBlock = {
  ordinal: number
  type: CanonicalBlockType
  content: string
  headingPath: string[]
  charStart: number
  charEnd: number
}

export type DurableSourceExtraction = {
  sourceText: string
  limitations: string[]
  sourceDocumentIds: string[]
  sourceVersionIds: string[]
  sourceIngestionJobIds: string[]
}

function sourceFiles(formData: FormData) {
  return [...formData.entries()]
    .filter((entry): entry is [string, File] => entry[0] === 'sources' && entry[1] instanceof File)
    .map(([, file]) => file)
}

function maxSourceBytes() {
  const configured = Number(process.env.MAX_SOURCE_FILE_BYTES ?? DEFAULT_MAX_SOURCE_BYTES)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_SOURCE_BYTES
}

async function uploadOriginal(
  db: Db,
  file: File,
  metadata: Record<string, unknown>,
) {
  const bucket = new GridFSBucket(db, { bucketName: SOURCE_OBJECT_BUCKET })
  const bytes = Buffer.from(await file.arrayBuffer())
  const upload = bucket.openUploadStream(file.name, {
    contentType: file.type || 'application/octet-stream',
    metadata,
  })

  await new Promise<void>((resolve, reject) => {
    upload.once('error', reject)
    upload.once('finish', () => resolve())
    upload.end(bytes)
  })

  return {
    objectId: upload.id,
    checksum: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  }
}

async function downloadOriginal(db: Db, objectId: ObjectId) {
  const bucket = new GridFSBucket(db, { bucketName: SOURCE_OBJECT_BUCKET })
  const chunks: Buffer[] = []
  const stream = bucket.openDownloadStream(objectId)

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    stream.once('error', reject)
    stream.once('end', resolve)
  })

  return Buffer.concat(chunks)
}

function blockType(content: string): CanonicalBlockType {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length && lines.every((line) => /^([-*+]|\d+\.)\s+/.test(line))) return 'list'
  if (lines.length >= 2 && lines.every((line) => line.includes('|'))) return 'table'
  return 'paragraph'
}

function canonicalize(text: string): CanonicalBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  const lines = normalized.split('\n')
  const blocks: CanonicalBlock[] = []
  const headingPath: string[] = []
  let buffer: string[] = []
  let codeBuffer: string[] = []
  let inCode = false
  let cursor = 0

  function push(content: string, type: CanonicalBlockType) {
    const clean = content.trim()
    if (!clean) return
    const found = normalized.indexOf(clean, cursor)
    const charStart = found >= 0 ? found : cursor
    const charEnd = charStart + clean.length
    cursor = charEnd
    blocks.push({
      ordinal: blocks.length,
      type,
      content: clean,
      headingPath: [...headingPath],
      charStart,
      charEnd,
    })
  }

  function flushBuffer() {
    if (!buffer.length) return
    const content = buffer.join('\n')
    buffer = []
    push(content, blockType(content))
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushBuffer()
      codeBuffer.push(line)
      if (inCode) {
        push(codeBuffer.join('\n'), 'code')
        codeBuffer = []
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flushBuffer()
      const level = heading[1].length
      const title = heading[2].trim()
      headingPath.splice(level - 1)
      headingPath[level - 1] = title
      push(line, 'heading')
      continue
    }

    if (!line.trim()) {
      flushBuffer()
      continue
    }
    buffer.push(line)
  }

  flushBuffer()
  if (codeBuffer.length) push(codeBuffer.join('\n'), 'code')
  return blocks
}

function buildPassages(blocks: CanonicalBlock[]) {
  const passages: Array<{
    ordinal: number
    content: string
    headingPath: string[]
    blockOrdinals: number[]
    charStart: number
    charEnd: number
  }> = []
  let current: CanonicalBlock[] = []
  let currentLength = 0
  let currentHeading = ''

  function flush() {
    if (!current.length) return
    const content = current.map((block) => block.content).join('\n\n').trim()
    if (content) {
      passages.push({
        ordinal: passages.length,
        content,
        headingPath: [...(current.findLast((block) => block.headingPath.length)?.headingPath ?? [])],
        blockOrdinals: current.map((block) => block.ordinal),
        charStart: Math.min(...current.map((block) => block.charStart)),
        charEnd: Math.max(...current.map((block) => block.charEnd)),
      })
    }
    const overlap = current.at(-1)
    current = overlap && overlap.type !== 'heading' && overlap.content.length <= 500 ? [overlap] : []
    currentLength = current.reduce((sum, block) => sum + block.content.length + 2, 0)
  }

  for (const block of blocks) {
    const headingKey = block.headingPath.join(' > ')
    const sectionChanged = current.length > 0 && headingKey !== currentHeading && block.type === 'heading'
    const wouldOverflow = currentLength + block.content.length + 2 > PASSAGE_MAX_CHARS
    if (sectionChanged || wouldOverflow) flush()
    current.push(block)
    currentLength += block.content.length + 2
    currentHeading = headingKey
    if (currentLength >= PASSAGE_TARGET_CHARS) flush()
  }
  flush()
  return passages
}

export async function embedSourcePassageById(db: Db, passageId: string) {
  const passage = await db.collection('sourcePassages').findOne({ _id: passageId as any })
  if (!passage) return false

  await db.collection('sourcePassages').updateOne(
    { _id: passage._id },
    { $set: { embedding_status: 'processing', embedding_error: null } },
  )

  try {
    const embedding = await embedText(
      [`Source: ${passage.source_title}`, passage.content].filter(Boolean).join('\n'),
      'RETRIEVAL_DOCUMENT',
    )
    await db.collection('sourcePassages').updateOne(
      { _id: passage._id },
      {
        $set: {
          embedding,
          embedding_provider: ACTIVE_EMBEDDING_PROVIDER,
          embedding_model: ACTIVE_EMBEDDING_MODEL,
          embedding_dimensions: ACTIVE_EMBEDDING_DIMENSIONS,
          embedding_version: ACTIVE_EMBEDDING_VERSION,
          embedding_status: 'ready',
          embedding_error: null,
          embedding_updated_at: new Date(),
        },
      },
    )
    return true
  } catch (error) {
    await db.collection('sourcePassages').updateOne(
      { _id: passage._id },
      {
        $set: {
          embedding_status: 'failed',
          embedding_error: error instanceof Error ? error.message : String(error),
          embedding_updated_at: new Date(),
        },
      },
    )
    return false
  }
}

async function uploadImageBytes(
  db: Db,
  bytes: Buffer,
  filename: string,
  contentType: string,
  metadata: Record<string, unknown>,
) {
  const bucket = new GridFSBucket(db, { bucketName: SOURCE_IMAGE_BUCKET })
  const upload = bucket.openUploadStream(filename, { contentType, metadata })
  await new Promise<void>((resolve, reject) => {
    upload.once('error', reject)
    upload.once('finish', () => resolve())
    upload.end(bytes)
  })
  return upload.id
}

/**
 * Persist extracted source images as first-class assets: bytes in GridFS, metadata
 * (page, caption, classification, OCR, figure label, nearby context) + a caption
 * embedding in the `sourceImages` collection for image-aware retrieval. Idempotent
 * per source version. Best-effort: a failed image never fails the ingestion job.
 */
async function storeSourceImages(
  db: Db,
  version: any,
  job: any,
  images: ExtractedSourceImage[],
) {
  if (!images.length) return 0
  // Idempotent re-run: drop prior assets for this version first.
  const prior = await db.collection('sourceImages')
    .find({ source_version_id: String(version._id) })
    .project({ object_id: 1 })
    .toArray()
  if (prior.length) {
    const bucket = new GridFSBucket(db, { bucketName: SOURCE_IMAGE_BUCKET })
    await Promise.all(prior.map(async (doc) => {
      if (!doc.object_id) return
      try { await bucket.delete(new ObjectId(String(doc.object_id))) } catch { /* already gone */ }
    }))
    await db.collection('sourceImages').deleteMany({ source_version_id: String(version._id) })
  }

  let stored = 0
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    if (!image.data) continue // service ran in text-only mode — caption already in text
    try {
      const bytes = Buffer.from(image.data, 'base64')
      const imageId = crypto.randomUUID()
      const objectId = await uploadImageBytes(
        db,
        bytes,
        `${version.filename ?? 'source'}-p${image.page}-${index}.jpg`,
        image.mime ?? 'image/jpeg',
        {
          user_id: job.user_id,
          source_version_id: String(version._id),
          source_image_id: imageId,
        },
      )

      // Embed caption + OCR text so the AI can retrieve the right figure by meaning.
      const captionText = [image.caption, image.ocr_text].filter(Boolean).join('\n').trim()
      let embedding: number[] | null = null
      let embeddingStatus: 'ready' | 'failed' | 'skipped' = 'skipped'
      if (captionText) {
        try {
          embedding = await embedText(
            [`Figure from ${version.filename}`, captionText].filter(Boolean).join('\n'),
            'RETRIEVAL_DOCUMENT',
          )
          embeddingStatus = 'ready'
        } catch {
          embeddingStatus = 'failed'
        }
      }

      await db.collection('sourceImages').insertOne({
        _id: imageId as any,
        user_id: job.user_id,
        generation_job_id: job.generation_job_id,
        course_id: version.course_id ?? null,
        source_document_id: String(version.source_document_id),
        source_version_id: String(version._id),
        source_index: version.source_index,
        source_title: version.filename,
        page: image.page,
        order: image.order,
        caption: image.caption,
        classification: image.classification,
        chart_type: image.chart_type,
        ocr_text: image.ocr_text,
        relevance: image.relevance,
        figure_label: image.figure_label,
        nearby_text: image.nearby_text,
        content_hash: image.content_hash,
        width: image.width ?? null,
        height: image.height ?? null,
        mime: image.mime ?? 'image/jpeg',
        object_store: {
          provider: 'mongodb_gridfs',
          bucket: SOURCE_IMAGE_BUCKET,
          object_id: String(objectId),
        },
        object_id: String(objectId),
        embedding,
        embedding_provider: embedding ? ACTIVE_EMBEDDING_PROVIDER : null,
        embedding_model: embedding ? ACTIVE_EMBEDDING_MODEL : null,
        embedding_dimensions: embedding ? ACTIVE_EMBEDDING_DIMENSIONS : null,
        embedding_version: embedding ? ACTIVE_EMBEDDING_VERSION : null,
        embedding_status: embeddingStatus,
        schema_version: INGESTION_SCHEMA_VERSION,
        created_at: new Date(),
      })
      stored += 1
    } catch (error) {
      console.warn(`[ingestion] failed to store image ${index} for ${version.filename}:`, error)
    }
  }
  return stored
}

export async function processSourceExtraction(db: Db, job: any) {
  const now = new Date()
  await db.collection('sourceIngestionJobs').updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'running',
        stage: 'parsing',
        lease_expires_at: new Date(now.getTime() + 5 * 60 * 1000),
        error: null,
        updated_at: now,
      },
      $inc: { attempts: 1 },
    },
  )

  try {
    const version = await db.collection('sourceDocumentVersions').findOne({
      _id: job.source_version_id as any,
      user_id: job.user_id,
    })
    if (!version) throw new Error('Source document version is missing.')

    const bytes = await downloadOriginal(db, new ObjectId(String(version.object_store.object_id)))
    const file = new File([bytes], String(version.filename), {
      type: String(version.mime_type ?? 'application/octet-stream'),
    })
    const extracted = await extractTextFromSourceFile(file)
    if (!extracted.text) throw new Error(extracted.limitation ?? 'No readable text was extracted.')

    const blocks = canonicalize(extracted.text)
    const passages = buildPassages(blocks)
    if (!blocks.length || !passages.length) throw new Error('The parser produced no canonical passages.')

    await db.collection('sourceIngestionJobs').updateOne(
      { _id: job._id },
      { $set: { stage: 'chunking', updated_at: new Date() } },
    )
    await Promise.all([
      db.collection('sourceBlocks').deleteMany({ source_version_id: String(version._id) }),
      db.collection('sourcePassages').deleteMany({ source_version_id: String(version._id) }),
    ])

    await db.collection('sourceBlocks').insertMany(blocks.map((block) => ({
      _id: crypto.randomUUID() as any,
      user_id: job.user_id,
      generation_job_id: job.generation_job_id,
      course_id: version.course_id ?? null,
      source_document_id: String(version.source_document_id),
      source_version_id: String(version._id),
      source_index: version.source_index,
      ordinal: block.ordinal,
      block_type: block.type,
      heading_path: block.headingPath,
      content: block.content,
      char_start: block.charStart,
      char_end: block.charEnd,
      parser_version: INGESTION_SCHEMA_VERSION,
      created_at: new Date(),
    })))

    const passageDocs = passages.map((passage) => ({
      _id: crypto.randomUUID() as any,
      user_id: job.user_id,
      generation_job_id: job.generation_job_id,
      course_id: version.course_id ?? null,
      source_document_id: String(version.source_document_id),
      source_version_id: String(version._id),
      source_index: version.source_index,
      source_title: version.filename,
      ordinal: passage.ordinal,
      heading_path: passage.headingPath,
      block_ordinals: passage.blockOrdinals,
      char_start: passage.charStart,
      char_end: passage.charEnd,
      content: passage.content,
      content_hash: crypto.createHash('sha256').update(passage.content).digest('hex'),
      estimated_tokens: Math.ceil(passage.content.length / 4),
      chunker_version: CHUNKER_VERSION,
      embedding_status: 'pending',
      created_at: new Date(),
    }))
    await db.collection('sourcePassages').insertMany(passageDocs)

    // Persist extracted images as first-class assets (best-effort, never fatal).
    let imageCount = 0
    try {
      imageCount = await storeSourceImages(db, version, job, extracted.images ?? [])
    } catch (error) {
      console.warn(`[ingestion] image storage failed for ${version.filename}:`, error)
    }

    await db.collection('sourceDocumentVersions').updateOne(
      { _id: version._id },
      {
        $set: {
          extracted_text: extracted.text,
          extraction_status: 'ready',
          parser_version: INGESTION_SCHEMA_VERSION,
          chunker_version: CHUNKER_VERSION,
          block_count: blocks.length,
          passage_count: passageDocs.length,
          image_count: imageCount,
          updated_at: new Date(),
        },
      },
    )

    await db.collection('sourceIngestionJobs').updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'running',
          stage: 'text_ready',
          lease_expires_at: null,
          updated_at: new Date(),
        },
      },
    )
  } catch (error) {
    await Promise.all([
      db.collection('sourceDocuments').updateOne(
        { _id: job.source_document_id as any },
        {
          $set: {
            status: 'failed',
            updated_at: new Date(),
          },
        },
      ),
      db.collection('sourceDocumentVersions').updateOne(
        { _id: job.source_version_id as any },
        {
          $set: {
            extraction_status: 'failed',
            extraction_error: error instanceof Error ? error.message : String(error),
            updated_at: new Date(),
          },
        },
      ),
      db.collection('sourceIngestionJobs').updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'failed',
            stage: 'parsing',
            error: error instanceof Error ? error.message : String(error),
            lease_expires_at: null,
            updated_at: new Date(),
          },
        },
      ),
    ])
    throw error
  }
}

export async function processSourceEmbedding(db: Db, job: any) {
  const now = new Date()
  await db.collection('sourceIngestionJobs').updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'running',
        stage: 'embedding',
        lease_expires_at: new Date(now.getTime() + 10 * 60 * 1000),
        error: null,
        updated_at: now,
      },
    },
  )

  try {
    const version = await db.collection('sourceDocumentVersions').findOne({
      _id: job.source_version_id as any,
      user_id: job.user_id,
    })
    if (!version) throw new Error('Source document version is missing.')

    const passages = await db.collection('sourcePassages')
      .find({ source_version_id: String(version._id) })
      .toArray()

    let failedEmbeddings = 0
    const concurrency = 4
    for (let offset = 0; offset < passages.length; offset += concurrency) {
      const batch = passages.slice(offset, offset + concurrency)
      const results = await Promise.all(
        batch.map((passage) => {
          if (passage.embedding_status === 'ready' && passage.embedding_version === ACTIVE_EMBEDDING_VERSION) {
            return Promise.resolve(true)
          }
          return embedSourcePassageById(db, String(passage._id))
        }),
      )
      failedEmbeddings += results.filter((ready) => !ready).length
    }

    const completed = failedEmbeddings === 0
    await Promise.all([
      db.collection('sourceDocuments').updateOne(
        { _id: version.source_document_id as any },
        {
          $set: {
            status: completed ? 'ready' : 'partial',
            updated_at: new Date(),
          },
        },
      ),
      db.collection('sourceDocumentVersions').updateOne(
        { _id: version._id },
        {
          $set: {
            retrieval_status: completed ? 'ready' : 'partial',
            embedding_version: ACTIVE_EMBEDDING_VERSION,
            updated_at: new Date(),
          },
        },
      ),
      db.collection('sourceIngestionJobs').updateOne(
        { _id: job._id },
        {
          $set: {
            status: completed ? 'completed' : 'retryable',
            stage: completed ? 'completed' : 'embedding',
            error: completed ? null : `${failedEmbeddings} passage embeddings failed.`,
            lease_expires_at: null,
            completed_at: completed ? new Date() : null,
            updated_at: new Date(),
          },
        },
      ),
    ])
  } catch (error) {
    await db.collection('sourceIngestionJobs').updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'retryable',
          error: error instanceof Error ? error.message : String(error),
          lease_expires_at: null,
          updated_at: new Date(),
        },
      },
    )
    throw error
  }
}

export async function processSourceIngestionJob(db: Db, jobId: string) {
  const job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
  if (!job) throw new Error(`Source ingestion job ${jobId} was not found.`)
  if (job.status === 'completed') return
  if (Number(job.attempts ?? 0) >= Number(job.max_attempts ?? 3)) {
    throw new Error(`Source ingestion job ${jobId} exhausted its retry budget.`)
  }

  if (job.stage === 'queued' || job.stage === 'parsing' || job.stage === 'chunking') {
    await processSourceExtraction(db, job)
  }
  const updatedJob = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
  if (updatedJob && updatedJob.stage === 'text_ready') {
    await processSourceEmbedding(db, updatedJob)
  }
}

export async function ingestSourceFilesFromFormData({
  db,
  userId,
  generationJobId,
  formData,
}: {
  db: Db
  userId: string
  generationJobId: string
  formData: FormData
}): Promise<DurableSourceExtraction> {
  const limitations: string[] = []
  const sourceDocumentIds: string[] = []
  const sourceVersionIds: string[] = []
  const sourceIngestionJobIds: string[] = []
  const files = sourceFiles(formData)

  for (let sourceIndex = 0; sourceIndex < files.length; sourceIndex += 1) {
    const file = files[sourceIndex]
    if (!isTextSource(file) && !isRichSource(file)) {
      limitations.push(`${file.name}: unsupported source format.`)
      continue
    }
    if (file.size > maxSourceBytes()) {
      limitations.push(`${file.name} exceeds the ${Math.round(maxSourceBytes() / 1024 / 1024)} MB source limit.`)
      continue
    }

    const documentId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const ingestionJobId = `${versionId}:ingest:v1`
    const stored = await uploadOriginal(db, file, {
      user_id: userId,
      generation_job_id: generationJobId,
      source_document_id: documentId,
      source_version_id: versionId,
    })
    const now = new Date()

    await Promise.all([
      db.collection('sourceDocuments').insertOne({
        _id: documentId as any,
        user_id: userId,
        generation_job_id: generationJobId,
        course_id: null,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: stored.size,
        checksum_sha256: stored.checksum,
        current_version_id: versionId,
        source_index: sourceIndex,
        status: 'processing',
        created_at: now,
        updated_at: now,
      }),
      db.collection('sourceDocumentVersions').insertOne({
        _id: versionId as any,
        user_id: userId,
        generation_job_id: generationJobId,
        course_id: null,
        source_document_id: documentId,
        version_number: 1,
        source_index: sourceIndex,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: stored.size,
        checksum_sha256: stored.checksum,
        object_store: {
          provider: 'mongodb_gridfs',
          bucket: SOURCE_OBJECT_BUCKET,
          object_id: String(stored.objectId),
        },
        extraction_status: 'pending',
        retrieval_status: 'pending',
        schema_version: INGESTION_SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
      }),
      db.collection('sourceIngestionJobs').insertOne({
        _id: ingestionJobId as any,
        user_id: userId,
        generation_job_id: generationJobId,
        source_document_id: documentId,
        source_version_id: versionId,
        source_index: sourceIndex,
        job_type: 'parse_chunk_embed',
        status: 'queued',
        stage: 'queued',
        attempts: 0,
        max_attempts: 3,
        error: null,
        lease_expires_at: null,
        created_at: now,
        updated_at: now,
      }),
    ])

    sourceDocumentIds.push(documentId)
    sourceVersionIds.push(versionId)
    sourceIngestionJobIds.push(ingestionJobId)
  }

  return {
    sourceText: '',
    limitations,
    sourceDocumentIds,
    sourceVersionIds,
    sourceIngestionJobIds,
  }
}

export async function resumeSourceExtractionJobs(db: Db, jobIds: string[]) {
  for (const jobId of jobIds) {
    let job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
    const stagesOfExtracted = ['text_ready', 'embedding', 'completed']
    while (job && !stagesOfExtracted.includes(String(job.stage)) && Number(job.attempts ?? 0) < Number(job.max_attempts ?? 3)) {
      try {
        await processSourceExtraction(db, job)
      } catch (e) {
        console.error(`[ingestion] processSourceExtraction failed for job ${jobId}:`, e)
        break
      }
      job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
    }
  }
}

export async function resumeSourceEmbeddingJobs(db: Db, jobIds: string[]) {
  for (const jobId of jobIds) {
    let job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
    while (job && job.status !== 'completed' && job.stage !== 'completed' && Number(job.attempts ?? 0) < Number(job.max_attempts ?? 3)) {
      try {
        if (job.stage === 'queued' || job.stage === 'parsing' || job.stage === 'chunking') {
          await processSourceExtraction(db, job)
          job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
          continue
        }
        await processSourceEmbedding(db, job)
      } catch (e) {
        console.error(`[ingestion] processSourceEmbedding failed for job ${jobId}:`, e)
        break
      }
      job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
    }
  }
}

export async function waitForSourceRetrievalReadiness(
  db: Db,
  versionIds: string[],
  options: { timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 4000
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const versions = await db.collection('sourceDocumentVersions')
      .find({ _id: { $in: versionIds as any[] } })
      .toArray()
    const allReady = versions.every(v => v.retrieval_status === 'ready')
    if (allReady) {
      return { status: 'ready' as const }
    }
    const anyFailed = versions.some(v => v.retrieval_status === 'failed')
    if (anyFailed) {
      return { status: 'failed' as const }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  const versions = await db.collection('sourceDocumentVersions')
    .find({ _id: { $in: versionIds as any[] } })
    .toArray()
  const isPartial = versions.some(v => v.retrieval_status === 'ready')
  return { status: isPartial ? ('partial' as const) : ('pending' as const) }
}

export async function resumeSourceIngestionJobs(db: Db, jobIds: string[]) {
  for (const jobId of jobIds) {
    let job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
    while (job && job.status !== 'completed' && Number(job.attempts ?? 0) < Number(job.max_attempts ?? 3)) {
      await processSourceIngestionJob(db, jobId)
      job = await db.collection('sourceIngestionJobs').findOne({ _id: jobId as any })
    }
    if (!job || job.status !== 'completed') {
      throw new Error(`Source ingestion did not complete for ${job?.source_document_id ?? jobId}: ${job?.error ?? 'unknown error'}`)
    }
  }
}

export async function readIngestedSourceText(
  db: Db,
  userId: string,
  sourceVersionIds: string[],
) {
  const versions = await db.collection('sourceDocumentVersions')
    .find({ user_id: userId, _id: { $in: sourceVersionIds as any[] } })
    .toArray()
  const byId = new Map(versions.map((version) => [String(version._id), version]))
  const limitations: string[] = []
  const blocks: string[] = []

  for (const versionId of sourceVersionIds) {
    const version = byId.get(versionId)
    if (version?.extracted_text) {
      blocks.push(`Source ${blocks.length + 1}: ${version.filename}\n${String(version.extracted_text).trim()}`)
    } else {
      limitations.push(
        `${version?.filename ?? 'Source file'} could not be read: ${version?.extraction_error ?? 'no extracted text is available.'}`,
      )
    }
  }

  return {
    sourceText: blocks.join('\n\n---\n\n'),
    limitations,
  }
}

export async function attachIngestedSourcesToCourse({
  db,
  userId,
  generationJobId,
  courseId,
  sourceVersionIds,
}: {
  db: Db
  userId: string
  generationJobId?: string
  courseId: string
  sourceVersionIds: string[]
}) {
  const filter = {
    user_id: userId,
    source_version_id: { $in: sourceVersionIds },
  }
  await Promise.all([
    db.collection('sourceDocuments').updateMany(
      { user_id: userId, current_version_id: { $in: sourceVersionIds } },
      { $set: { course_id: courseId, updated_at: new Date() } },
    ),
    db.collection('sourceDocumentVersions').updateMany(
      { user_id: userId, _id: { $in: sourceVersionIds as any[] } },
      { $set: { course_id: courseId, updated_at: new Date() } },
    ),
    db.collection('sourceBlocks').updateMany(filter, { $set: { course_id: courseId } }),
    db.collection('sourcePassages').updateMany(filter, { $set: { course_id: courseId } }),
    db.collection('sourceImages').updateMany(filter, { $set: { course_id: courseId } }),
    generationJobId
      ? db.collection('sourceIngestionJobs').updateMany(
          { user_id: userId, generation_job_id: generationJobId },
          { $set: { course_id: courseId, updated_at: new Date() } },
        )
      : Promise.resolve(),
  ])

  const passages = await db.collection('sourcePassages')
    .find({ ...filter, course_id: courseId })
    .sort({ source_index: 1, ordinal: 1 })
    .toArray()

  if (passages.length) {
    await db.collection('sourceChunks').bulkWrite(passages.map((passage) => ({
      updateOne: {
        filter: { _id: passage._id },
        update: {
          $set: {
            course_id: courseId,
            user_id: userId,
            source_document_id: passage.source_document_id,
            source_version_id: passage.source_version_id,
            source_index: passage.source_index,
            source_title: passage.source_title ?? null,
            chunk_index: passage.ordinal,
            passage_ordinal: passage.ordinal,
            heading_path: passage.heading_path ?? [],
            block_ordinals: passage.block_ordinals ?? [],
            char_start: passage.char_start ?? null,
            char_end: passage.char_end ?? null,
            content: passage.content,
            content_hash: passage.content_hash,
            estimated_tokens: passage.estimated_tokens,
            chunker_version: passage.chunker_version,
            embedding: passage.embedding,
            embedding_provider: passage.embedding_provider,
            embedding_model: passage.embedding_model,
            embedding_dimensions: passage.embedding_dimensions,
            embedding_version: passage.embedding_version,
            embedding_status: passage.embedding_status,
            embedding_error: passage.embedding_error ?? null,
            embedding_updated_at: passage.embedding_updated_at ?? null,
            created_at: passage.created_at ?? new Date(),
          },
        },
        upsert: true,
      },
    })), { ordered: false })
  }

  return {
    passageCount: passages.length,
    pendingChunkIds: passages
      .filter((passage) =>
        passage.embedding_version !== ACTIVE_EMBEDDING_VERSION || passage.embedding_status !== 'ready')
      .map((passage) => String(passage._id)),
  }
}
