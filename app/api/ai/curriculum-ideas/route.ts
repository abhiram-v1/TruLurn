import { NextResponse } from 'next/server'
import { generateAI, parseAIJson } from '@/lib/ai'

export const dynamic = 'force-dynamic'

type CurriculumIdea = {
  title: string
  category: string
  goal: string
}

// Diverse domain pool biased toward major, cohesive academic and professional disciplines
const DOMAIN_POOL = [
  'computer science', 'software engineering', 'finance & economics', 'mathematics',
  'biological sciences', 'physical sciences', 'history & humanities', 'business & management',
  'data science & analytics', 'languages & linguistics', 'philosophy & ethics', 'law & governance',
]

// Shown instantly while the AI batch loads, and as a graceful fallback.
const FALLBACK_IDEAS: CurriculumIdea[] = [
  {
    title: 'Introduction to Systems Programming',
    category: 'Computer Science',
    goal: 'I want to master low-level systems programming in C well enough to build custom memory allocators and concurrent network servers from scratch.',
  },
  {
    title: 'Fundamentals of Corporate Finance',
    category: 'Finance',
    goal: 'I want to learn corporate finance and valuation techniques well enough to build discounted cash flow (DCF) valuation models and analyze company balance sheets from scratch.',
  },
  {
    title: 'Linear Algebra for Machine Learning',
    category: 'Mathematics',
    goal: 'I want to master linear algebra well enough to implement dimensionality reduction and matrix factorization algorithms in Python from scratch.',
  },
  {
    title: 'Cellular Biology and Genetics',
    category: 'Biology',
    goal: 'I want to learn cellular biology and genetics well enough to explain the mechanisms of transcription, translation, and CRISPR gene editing workflows.',
  },
  {
    title: 'Modern History of East Asia',
    category: 'History',
    goal: 'I want to study modern East Asian history well enough to analyze the key political reforms and economic transitions of China, Japan, and Korea in the 20th century.',
  },
  {
    title: 'Object-Oriented Design Patterns',
    category: 'Software Engineering',
    goal: 'I want to master object-oriented design patterns well enough to refactor legacy codebases and build extensible software components using SOLID design principles.',
  },
]

function randomThemes(count: number): string[] {
  const pool = [...DOMAIN_POOL]
  const picked: string[] = []
  for (let i = 0; i < count && pool.length; i += 1) {
    const idx = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(idx, 1)[0])
  }
  return picked
}

function sanitize(raw: unknown): CurriculumIdea[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => ({
      title: String((item as any)?.title ?? '').trim().replace(/[.\s]+$/, ''),
      category: String((item as any)?.category ?? '').trim().slice(0, 18),
      goal: String((item as any)?.goal ?? '').trim(),
    }))
    .filter((idea) => idea.title.length >= 3 && idea.goal.length >= 30)
    .slice(0, 8)
}

export async function POST(request: Request) {
  let count = 6
  try {
    const body = await request.json().catch(() => ({}))
    if (Number.isFinite(Number(body?.count))) {
      count = Math.min(8, Math.max(3, Number(body.count)))
    }
  } catch {
    // ignore — use default count
  }

  const themes = randomThemes(4)

  const system = `You generate fresh, inspiring learning-goal ideas for a course builder. These ideas MUST represent complete, cohesive learning courses (such as academic subjects, professional fields, or programming languages) rather than narrow, single-project tasks or physical actions that a text-and-quiz-based AI platform cannot realistically verify.
Return ONLY a JSON array (no markdown fences) of objects shaped exactly:
[{"title": string, "category": string, "goal": string}]

For each idea:
- "title": the name of a whole, cohesive course (3 to 7 words) that represents a realistic subject to master (e.g., "Introduction to Systems Programming", "Fundamentals of Corporate Finance", "Linear Algebra for Machine Learning"). Avoid single narrow tasks like 'design a website layout' or 'make a 3D model'.
- "category": a single short domain tag, 1 to 2 words (e.g. "Computer Science", "Finance", "Mathematics", "Biology", "History").
- "goal": a direct, first-person outcome-based learning goal prompt of 1 to 2 sentences starting with "I want to...". It must describe the target mastery and concrete outcome (what they will build, analyze, or explain from scratch) rather than describing the course syllabus or listing what topics "will be covered". Keep it punchy and highly actionable (e.g., "I want to master low-level systems programming in C well enough to build custom memory allocators and concurrent network servers from scratch.").

Rules:
- Make the ideas DIVERSE across genuinely different fields — never cluster around one domain.
- Vary difficulty and audience.
- Output ONLY the JSON array.`

  const user = `Generate ${count} diverse, realistic, whole-course learning-goal ideas. Lean toward variety; you may draw inspiration from these fields this round, but do not feel limited to them: ${themes.join(', ')}. Return only the JSON array.`

  try {
    const raw = await generateAI({
      feature: 'curriculum_ideas',
      system,
      user,
      responseMimeType: 'text/plain',
    })
    const ideas = sanitize(parseAIJson<unknown>(raw))
    if (ideas.length >= 3) {
      return NextResponse.json({ ideas, source: 'ai' })
    }
    return NextResponse.json({ ideas: FALLBACK_IDEAS.slice(0, count), source: 'fallback' })
  } catch (error) {
    console.warn('[curriculum-ideas] generation failed, using fallback:', error)
    return NextResponse.json({ ideas: FALLBACK_IDEAS.slice(0, count), source: 'fallback' })
  }
}
