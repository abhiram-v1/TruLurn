// Dev harness: preview a SOURCE-GROUNDED lesson opening using the REAL edited
// SYSTEM prompt + the REAL source fidelity/citation contract extracted from
// lib/topic-pages/generateTopicPage.ts. Proves the anti-meta-narration fix:
// the model should TEACH the spam example directly, not report "the source uses...".
import { readFileSync } from 'node:fs'

const env = {}
for (const f of ['.env.local', '.env.development.local']) {
  try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim() } } catch {}
}

const src = readFileSync(new URL('../lib/topic-pages/generateTopicPage.ts', import.meta.url), 'utf8')
const SYSTEM = src.match(/const SYSTEM = `([\s\S]*?)`\s*\nconst USER_TEMPLATE/)?.[1]
// Extract the real, just-edited citation contract block text (between the markers).
const contract = src.match(/SOURCE FIDELITY & CITATION CONTRACT:[\s\S]*?- If the evidence does not support a claim, omit it rather than guess\./)?.[0]
if (!SYSTEM || !contract) { console.error('extract failed', { SYSTEM: !!SYSTEM, contract: !!contract }); process.exit(1) }

// A realistic source excerpt (Géron-style) the way it would be retrieved.
const SOURCE = `BEGIN_UNTRUSTED_SOURCE_EVIDENCE
[S1] Machine Learning is the science (and art) of programming computers so they can learn from data. A more general definition: "the field of study that gives computers the ability to learn without being explicitly programmed." (Arthur Samuel, 1959). A more engineering-oriented one: "A computer program is said to learn from experience E with respect to some task T and some performance measure P, if its performance on T, as measured by P, improves with experience E." (Tom Mitchell, 1997). Example: a spam filter is a Machine Learning program that, given examples of spam emails (flagged by users) and examples of regular emails, can learn to flag spam. The examples the system uses to learn are called the training set.
END_UNTRUSTED_SOURCE_EVIDENCE`

const USER = `STUDENT KNOWLEDGE LEVEL: Beginner — completely new to the subject.

Course: Practical Machine Learning Foundations
Goal: Understand machine learning well enough to explain and apply it.
Topic: What Is Machine Learning?
Description: The foundational definition of machine learning and why it beats hand-written rules.
Suggested depth: medium
Page: 1 of 1
Page focus: Introduce machine learning, the problem it solves, and the core intuition.

SOURCE MATERIAL FOR THIS PAGE — teach FROM this as your own knowledge.
${SOURCE}
${contract}

Return in this EXACT format. Only <assessment> and <core> are always required.

<assessment>
{ "topic_depth": "medium", "concept_kind": "mechanism", "focus": "Introduce machine learning, the problem it solves, and the core intuition.", "summary": "...", "key_concepts": ["..."], "content_kind": "full_page", "should_generate_page": true, "estimated_length": "medium", "requires_quiz": false, "covered_concepts": ["..."], "reused_concepts": [], "reminder_concepts": [], "example_refs": [] }
</assessment>

<core>
## [Concept name]
[Lesson prose — teach directly, cite with [S1] unobtrusively.]
</core>`

const model = env.OPENAI_LESSON_MODEL || env.OPENAI_PRIMARY_MODEL || 'gpt-5.4'
console.log(`model: ${model}\n${'='.repeat(70)}\n`)
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

// Quick automated check for the banned meta-narration phrasings.
const banned = [/the source (says|uses|describes|defines|gives)/i, /in the source/i, /according to the source/i, /these two descriptions/i, /the (document|material|text) (says|describes)/i]
const hits = banned.filter((re) => re.test(text)).map((re) => re.source)
console.log(`\n${'='.repeat(70)}`)
console.log(hits.length ? `META-NARRATION DETECTED: ${hits.join(' | ')}` : 'No meta-narration phrasings detected ✅')
console.log(`[S1] occurrences: ${(text.match(/\[S\d+\]/g) || []).length}`)
