import crypto from 'crypto'
import type { Db } from 'mongodb'
import type { PersonaSurface } from '@/lib/personas'

export type CourseSkillSurface = PersonaSurface | 'planning'

export type CourseSkillReferenceDocument = {
  id?: string
  title: string
  content: string
  tags?: string[]
}

export type CourseSkillPack = {
  key: string
  version: number
  title: string
  status?: 'active' | 'disabled'
  retrieval_terms?: string[]
  instructions?: string | Partial<Record<CourseSkillSurface | 'shared', string>>
  documents?: CourseSkillReferenceDocument[]
}

export type RetrievedCourseSkillContext = {
  key: string
  text: string
  packKeys: string[]
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'when',
  'where', 'which', 'why', 'with',
])

function compact(value: unknown, max: number) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function tokenize(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9+#.-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

export function resolveCourseSkillKeys(course: any): string[] {
  const values = [
    ...(Array.isArray(course?.course_skill_keys) ? course.course_skill_keys : []),
    ...(Array.isArray(course?.skill_set_keys) ? course.skill_set_keys : []),
    course?.course_skill_key,
    course?.skill_set_key,
  ]
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function normalizePack(raw: any): CourseSkillPack | null {
  const key = String(raw?.key ?? raw?._id ?? '').trim()
  if (!key || raw?.status === 'disabled') return null
  return {
    key,
    version: Math.max(1, Number(raw?.version ?? 1)),
    title: String(raw?.title ?? raw?.name ?? key).trim(),
    status: 'active',
    retrieval_terms: Array.isArray(raw?.retrieval_terms) ? raw.retrieval_terms.map(String) : [],
    instructions: raw?.instructions,
    documents: Array.isArray(raw?.documents)
      ? raw.documents
          .map((document: any) => ({
            id: document?.id ? String(document.id) : undefined,
            title: String(document?.title ?? 'Reference').trim(),
            content: String(document?.content ?? '').trim(),
            tags: Array.isArray(document?.tags) ? document.tags.map(String) : [],
          }))
          .filter((document: CourseSkillReferenceDocument) => document.content)
      : [],
  }
}

function instructionForSurface(pack: CourseSkillPack, surface: CourseSkillSurface) {
  if (typeof pack.instructions === 'string') return pack.instructions.trim()
  if (!pack.instructions) return ''
  return [
    pack.instructions.shared,
    pack.instructions[surface],
  ].map((value) => String(value ?? '').trim()).filter(Boolean).join('\n')
}

function relevanceScore(queryTokens: Set<string>, pack: CourseSkillPack, document: CourseSkillReferenceDocument) {
  const searchable = tokenize([
    document.title,
    ...(document.tags ?? []),
    document.content,
  ].join(' '))
  const documentScore = searchable.reduce(
    (score, token) => score + (queryTokens.has(token) ? 1 : 0),
    0,
  )
  const packSignal = tokenize(pack.retrieval_terms ?? [])
    .some((token) => queryTokens.has(token))
    ? 0.25
    : 0
  return documentScore + packSignal
}

/**
 * Contract for future subject skill packs.
 *
 * Courses reference packs through `course_skill_keys: string[]`.
 * Packs live in `courseSkillPacks` and may contain trusted shared/surface
 * instructions plus reference documents. Retrieval is deliberately local and
 * bounded; no subject knowledge is hardcoded into the generator.
 */
export async function retrieveCourseSkillContext({
  db,
  course,
  query,
  surface,
  documentLimit = 4,
  maxChars = 6_000,
}: {
  db: Db
  course: any
  query: string
  surface: CourseSkillSurface
  documentLimit?: number
  maxChars?: number
}): Promise<RetrievedCourseSkillContext | null> {
  const keys = resolveCourseSkillKeys(course)
  if (!keys.length) return null

  const rawPacks = await db.collection('courseSkillPacks')
    .find({ key: { $in: keys }, status: { $ne: 'disabled' } })
    .toArray()
  const packs = rawPacks.map(normalizePack).filter((pack): pack is CourseSkillPack => Boolean(pack))
  if (!packs.length) return null

  const queryTokens = new Set(tokenize(query))
  const instructionBlocks = packs
    .map((pack) => {
      const instructions = instructionForSurface(pack, surface)
      return instructions ? `[${pack.title} v${pack.version}]\n${instructions}` : ''
    })
    .filter(Boolean)

  const documents = packs
    .flatMap((pack) => (pack.documents ?? []).map((document) => ({
      pack,
      document,
      score: relevanceScore(queryTokens, pack, document),
    })))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title))
    .slice(0, documentLimit)
    .map(({ pack, document }) =>
      `[${pack.title} / ${document.title}]\n${compact(document.content, 1_600)}`)

  const body = [
    'COURSE SKILL CONTEXT (trusted app-owned guidance):',
    ...instructionBlocks,
    ...documents,
  ].filter(Boolean).join('\n\n')
  if (!body.trim()) return null

  const text = body.length > maxChars ? `${body.slice(0, maxChars)}...` : body
  const fingerprint = packs
    .map((pack) => `${pack.key}@${pack.version}`)
    .sort()
    .join('|')

  return {
    key: crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16),
    text,
    packKeys: packs.map((pack) => pack.key),
  }
}
