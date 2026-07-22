import { NextResponse } from 'next/server'
import { generateAI, parseAIJson } from '@/lib/ai'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { apiUsageErrorResponse, consumeApiUsage } from '@/lib/server/apiUsage'

export const dynamic = 'force-dynamic'

type PreviewData = {
  title: string
  tagline: string
  modules: number
  lessons: number
  hours: number
  difficulty: number
  outcomes: string[]
  roadmap: string[]
}

const DEPTH_DESC: Record<string, string> = { low: 'overview', standard: 'standard', high: 'mastery' }
const LEVEL_DESC: Record<string, string> = { beginner: 'beginner', intermediate: 'intermediate', expert: 'expert' }
const PURPOSE_DESC: Record<string, string> = { explorer: 'explorer', practitioner: 'practitioner', researcher: 'researcher' }
const PATH_DESC: Record<string, string> = { guided: 'guided', balanced: 'balanced', open: 'open' }

function sanitize(raw: unknown): PreviewData | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const title = String(obj.title ?? '').trim()
  const tagline = String(obj.tagline ?? '').trim()
  const modules = Math.min(20, Math.max(3, Math.round(Number(obj.modules) || 6)))
  const lessons = Math.min(120, Math.max(6, Math.round(Number(obj.lessons) || 18)))
  const hours = Math.min(80, Math.max(2, Math.round(Number(obj.hours) || 8)))
  const difficulty = Math.min(5, Math.max(1, Math.round(Number(obj.difficulty) || 3)))

  const outcomes = Array.isArray(obj.outcomes)
    ? (obj.outcomes as unknown[]).map((o) => String(o).trim()).filter((o) => o.length > 5).slice(0, 6)
    : []

  const roadmap = Array.isArray(obj.roadmap)
    ? (obj.roadmap as unknown[]).map((r) => String(r).trim()).filter((r) => r.length > 3).slice(0, 10)
    : []

  if (!title || !tagline || outcomes.length < 2 || roadmap.length < 3) return null
  return { title, tagline, modules, lessons, hours, difficulty, outcomes, roadmap }
}

export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const body = await request.json().catch(() => ({}))
    const goal = String(body?.goal ?? '').trim()

    if (goal.length < 10) {
      return NextResponse.json({ error: 'Goal too short.' }, { status: 400 })
    }
    if (goal.length > 2000) {
      return NextResponse.json({ error: 'Goal must be 2,000 characters or fewer.' }, { status: 400 })
    }

    await consumeApiUsage({ userId, bucket: 'learning_tools', scope: 'ai-tools' })

    const depth = DEPTH_DESC[String(body?.depth)] ?? 'standard'
    const level = LEVEL_DESC[String(body?.level)] ?? 'intermediate'
    const purpose = PURPOSE_DESC[String(body?.purpose)] ?? 'practitioner'
    const path = PATH_DESC[String(body?.learningControl)] ?? 'balanced'
    const modeLabel = body?.mode === 'source_grounded' ? 'source-grounded' : 'AI-generated'

    const system = `You are a curriculum designer. Given a learner's goal and course settings, generate a realistic course preview. Return ONLY valid JSON — no markdown, no code fences — shaped exactly:
{
  "title": string,
  "tagline": string,
  "modules": number,
  "lessons": number,
  "hours": number,
  "difficulty": number,
  "outcomes": string[],
  "roadmap": string[]
}

Field rules:
- title: 3–7 words, specific to the goal (e.g. "Build ML Models from Scratch", not "Machine Learning Course")
- tagline: 8–12 words, outcome-focused, no hype words
- modules: realistic count based on depth (overview=4–6, standard=6–10, mastery=8–14) and level
- lessons: modules × 3–5, calibrated to depth
- hours: realistic study-hours estimate
- difficulty: 1–5 integer (1=accessible, 5=very demanding)
- outcomes: 4–5 items, each starting with a concrete action verb (Implement, Build, Analyze, Derive, Write, Design). Be specific about what is produced or demonstrated — not generic skills.
- roadmap: 6–8 module/topic names in study order, 3–6 words each, forming a coherent syllabus
Output ONLY the JSON object.`

    const user = `Goal: ${goal}

Settings: ${modeLabel} · ${depth} depth · ${level} level · ${purpose} focus · ${path} progression

Generate the course preview JSON.`

    const raw = await generateAI({
      feature: 'curriculum_preview',
      system,
      user,
      responseMimeType: 'application/json',
    })

    const parsed = sanitize(parseAIJson<unknown>(raw))
    if (!parsed) {
      return NextResponse.json({ error: 'Preview generation failed.' }, { status: 500 })
    }
    return NextResponse.json(parsed)
  } catch (error) {
    console.error('[curriculum-preview]', error)
    const limited = apiUsageErrorResponse(error)
    if (limited) return limited
    const message = error instanceof Error ? error.message : 'Preview generation failed.'
    const status = message.toLowerCase().includes('sign in') ? 401 : 500
    return NextResponse.json({ error: status === 401 ? message : 'Preview generation failed.' }, { status })
  }
}
