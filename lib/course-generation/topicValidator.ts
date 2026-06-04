import { generateWithGemini } from '@/lib/ai/gemini/client'
import { parseGeminiJson } from '@/lib/ai/gemini/json'

type TopicValidationResult =
  | { valid: true }
  | { valid: false; reason: string }

const SYSTEM = `You are a strict course-suitability evaluator for an educational mastery platform.
Determine whether a learning request can be structured into a multi-lesson course with modules and measurable outcomes.
Return only valid JSON. No markdown. No prose outside JSON.`

const UNSUITABLE_CASES = `
INVALID topics (reject these):
- Trivial everyday tasks: "how to cut an apple", "how to drink water", "how to tie shoelaces", "how to open a door"
- Simple one-off actions that require a single step, not weeks of study
- Common-sense lifestyle habits: "how to wake up early", "how to be happy", "how to reduce weight"
- Jokes, memes, random phrases, or meaningless input
- Anything that cannot support at least 5 distinct lessons with concrete learning outcomes

VALID topics (accept these):
- Technical or academic subjects: programming, mathematics, physics, chemistry, biology, history, economics
- Professional skills: project management, digital marketing, UX/UI design, cybersecurity, data science
- Creative disciplines: music theory, graphic design, creative writing, film production, photography
- Language learning: English, Spanish, Japanese (any human language)
- Career skills: public speaking, negotiation, leadership, financial planning
- Any domain where a learner could reasonably spend weeks mastering progressively harder material`

export async function validateTopicSuitability(goals: string): Promise<TopicValidationResult> {
  const user = `Evaluate whether this learning request is suitable for a structured multi-lesson course.
${UNSUITABLE_CASES}

Learning request:
"""
${goals}
"""

Rules:
- If uncertain, return valid=false (strict mode — prefer rejection over low-quality courses).
- A topic needs at least 5 distinct teachable lessons to be valid.
- A simple task or lifestyle tip is never valid, no matter how it is phrased.

Return exactly this JSON (no extra keys):
{
  "valid": true,
  "reason": ""
}
OR
{
  "valid": false,
  "reason": "one concise sentence explaining why this topic is not suitable"
}`

  try {
    const text = await generateWithGemini({ system: SYSTEM, user, purpose: 'primary' })
    const result = parseGeminiJson<{ valid: boolean; reason?: string }>(text)
    if (result.valid === false) {
      return { valid: false, reason: result.reason ?? 'Topic lacks sufficient educational depth.' }
    }
    return { valid: true }
  } catch {
    // Fail open — don't block users due to transient AI service errors.
    return { valid: true }
  }
}
