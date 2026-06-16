// Dev harness: generate a sample lesson page using the REAL (edited) SYSTEM prompt
// from lib/topic-pages/generateTopicPage.ts, to preview the writing voice.
// The USER block here is a representative stand-in (production assembles more
// directives); the SYSTEM — where the voice lives — is the genuine one.
import { readFileSync } from 'node:fs'

const env = {}
for (const f of ['.env.local', '.env.development.local']) {
  try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim() } } catch {}
}

const src = readFileSync(new URL('../lib/topic-pages/generateTopicPage.ts', import.meta.url), 'utf8')
const m = src.match(/const SYSTEM = `([\s\S]*?)`\s*\nconst USER_TEMPLATE/)
if (!m) { console.error('Could not extract SYSTEM prompt'); process.exit(1) }
const SYSTEM = m[1]
console.log(`(extracted SYSTEM prompt: ${SYSTEM.length} chars)\n`)

const USER = `STUDENT KNOWLEDGE LEVEL: Beginner — completely new to the subject.

Course: Introduction to Machine Learning
Goal: Understand what machine learning is and how it works, well enough to explain and apply it.
Topic: What Is Machine Learning?
Description: The foundational idea of machine learning and how it differs from traditional programming.
Suggested depth: medium
Page: 1 of 3
Page focus: Introduce machine learning, the problem it solves, and the core intuition.

Return in this EXACT format. Only <assessment> and <core> are always required.

<assessment>
{ "topic_depth": "medium", "concept_kind": "mechanism", "focus": "Introduce machine learning, the problem it solves, and the core intuition.", "summary": "...", "key_concepts": ["..."], "content_kind": "full_page", "should_generate_page": true, "estimated_length": "medium", "requires_quiz": false, "covered_concepts": ["..."], "reused_concepts": [], "reminder_concepts": [], "example_refs": [] }
</assessment>

<core>
## [Concept name]
[Lesson prose following the narrative arc.]
</core>`

const model = env.OPENAI_LESSON_MODEL || env.OPENAI_PRIMARY_MODEL || 'gpt-5.4'
console.log(`Generating with model: ${model}\n${'='.repeat(70)}\n`)

const res = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, input: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }] }),
  signal: AbortSignal.timeout(120_000),
})
const data = await res.json()
if (!res.ok) { console.error('API error:', data.error?.message ?? res.status); process.exit(1) }
const text = data.output_text?.trim()
  || (data.output ?? []).flatMap((i) => i.content ?? []).map((c) => c.text ?? '').join('\n').trim()
console.log(text)
