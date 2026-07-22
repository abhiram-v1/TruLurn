import { NextResponse } from 'next/server'
import { generateAI } from '@/lib/ai'
import { getRequiredUserId } from '@/lib/server/currentUser'
import { apiUsageErrorResponse, consumeApiUsage } from '@/lib/server/apiUsage'

export async function POST(request: Request) {
  try {
    const userId = await getRequiredUserId()
    const { prompt } = await request.json()

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 })
    }
    if (prompt.trim().length > 2000) {
      return NextResponse.json({ error: 'Prompt must be 2,000 characters or fewer.' }, { status: 400 })
    }

    await consumeApiUsage({ userId, bucket: 'learning_tools', scope: 'ai-tools' })

    const systemInstruction = `You rewrite a learner's raw learning goal into a sharp, structured goal that a course-generation system can turn into an excellent, well-scoped curriculum. The output goes directly into a "Learning goal" field that names and structures the whole course, so it must be information-rich but still read as one natural goal.

Rewrite the goal so it encodes, woven into natural prose (NOT a bulleted list):
1. OUTCOME — the concrete thing the learner will be able to DO or BUILD by the end (lead with this).
2. CAPABILITIES — 2 to 4 specific sub-skills or components that define what mastery actually means here.
3. SCOPE & DEPTH — a boundary that keeps the course finite and aimed (e.g. "from first principles", "to a production-ready level", "at an applied intermediate level"). Only state depth that is implied or reasonable — never invent a wildly specific constraint.
4. APPLICATION — the context or end-artifact the skill serves, when it can be reasonably inferred.

Hard rules:
- Write in the learner's first person ("I want to be able to..."), matching how the app frames goals.
- Preserve the learner's exact domain, technologies, and any specifics. NEVER swap the subject, narrow it to something they didn't ask for, or drop details they gave.
- If the input is vague (e.g. "finance", "guitar"), make it specific and outcome-based with the most common, broadly-useful interpretation — do not bolt on niche assumptions.
- 2 to 4 sentences. Specific and clear, not flowery, not corporate, no hype words ("master", "unlock", "journey", "dive deep").
- Output ONLY the rewritten goal text. No preamble, labels, headings, bullet points, quotes, or commentary.`

    const enhanced = await generateAI({
      feature: 'prompt_enhancement',
      system: systemInstruction,
      user: `Raw learning goal:\n${prompt.trim()}\n\nRewrite it following every rule above.`,
      responseMimeType: 'text/plain',
    })

    // Strip wrapping quotes/whitespace the model occasionally adds despite instructions.
    const cleaned = enhanced.trim().replace(/^["'""]+|["'""]+$/g, '').trim()

    return NextResponse.json({ enhanced: cleaned })
  } catch (error) {
    const limited = apiUsageErrorResponse(error)
    if (limited) return limited
    const message = error instanceof Error ? error.message : 'Prompt enhancement failed.'
    const status = message.toLowerCase().includes('sign in') ? 401 : 500
    return NextResponse.json({ error: status === 401 ? message : 'Prompt enhancement failed.' }, { status })
  }
}
