import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

function loadEnv(path) {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const split = trimmed.indexOf('=')
    if (split < 1) continue
    const key = trimmed.slice(0, split).trim()
    let value = trimmed.slice(split + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function extractTemplate(source, name, nextMarker) {
  const start = source.indexOf(`const ${name} = \``)
  if (start < 0) throw new Error(`Could not find ${name}`)
  const contentStart = start + `const ${name} = \``.length
  const end = source.indexOf(nextMarker, contentStart)
  if (end < 0) throw new Error(`Could not find end of ${name}`)
  return source.slice(contentStart, end).replace(/`\s*$/, '').trim()
}

function extractPath(source, name, nextName) {
  const pattern = new RegExp(`${name}:\\s*\\\`([\\s\\S]*?)\\\`,\\s*\\n\\s*${nextName}:`)
  const match = source.match(pattern)
  if (!match) throw new Error(`Could not find lesson path ${name}`)
  return match[1].trim()
}

function outputText(payload) {
  return payload?.output_text?.trim() || payload?.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('\n')
    .trim()
}

async function callOpenAI({ system, user, json = false, maxOutputTokens = 1600 }) {
  const started = performance.now()
  const body = {
    model: 'gpt-5.5',
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    reasoning: { effort: 'low' },
    max_output_tokens: maxOutputTokens,
  }
  if (json) body.text = { format: { type: 'json_object' } }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message ?? `OpenAI request failed (${response.status})`)
  const text = outputText(payload)
  if (!text) throw new Error('OpenAI returned an empty response')
  return {
    text,
    latencyMs: Math.round(performance.now() - started),
    usage: {
      inputTokens: payload.usage?.input_tokens ?? 0,
      cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
      totalTokens: (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0),
    },
  }
}

loadEnv(resolve('.env.local'))
if (!process.env.OPENAI_API_KEY) throw new Error('No OpenAI API key is configured')

const personaSource = readFileSync(resolve('lib/personas/immersiveBuilder.ts'), 'utf8')
const shared = extractTemplate(personaSource, 'SHARED', '\n\nconst LESSON_PATHS')
const majorPath = extractPath(personaSource, 'major_concept', 'technical')
const mathematicalPath = extractPath(personaSource, 'mathematical', '\\}\\n\\nconst SURFACE_DIRECTIVES')

const commonContract = `OUTPUT CONTRACT:
- Write one self-contained beginner-friendly lesson in Markdown, approximately 500-700 words.
- Give a precise, academically reliable definition early.
- Explain the intuition and mechanism, not merely a list of facts.
- Work through one concrete example.
- Name one important boundary or common misunderstanding.
- End with a compact > **Remember:** summary.
- Do not mention prompts, sources, exams, or interviews.`

const variants = {
  minimal: `Teach like a warm professor who is genuinely interested in the idea.

Give the formal definition, intuition, mechanism, one concrete example, and one important limitation. End with a brief memory summary.

Be conversational but restrained. Do not greet the learner, announce a lesson, say "welcome to class," role-play a classroom, praise the learner, or use theatrical questions. Begin directly inside the concept.

${commonContract}`,
  compressed: `You are a warm, intellectually excited professor. Reveal why the concept matters, then teach it with precision.

Teaching order:
1. Open with the real problem or tension the concept resolves; keep this brief.
2. State the canonical definition early in a > **Definition:** callout.
3. Unpack the definition in plain language without replacing its formal meaning.
4. Explain the mechanism with clear causal movement.
5. Work one concrete example and explicitly connect it to the mechanism.
6. Clarify the nearest misconception, boundary, or failure condition.
7. End with a compact > **Remember:** callout containing the definition and no more than three durable points.

Use authentic field vocabulary. Stay focused on the assigned concept. Avoid source-report language, generic textbook filler, hype, repeated explanations, and unnecessary lists.

${commonContract}`,
}

const topics = [
  {
    id: 'gradient-descent',
    title: 'Gradient Descent',
    fullPath: mathematicalPath,
    user: `Explain gradient descent to a beginner who understands basic algebra but has not studied calculus deeply.
Target understanding: why optimization is needed, what the gradient represents, how the update rule moves parameters, the role of learning rate, and why gradient descent can fail or behave poorly.`,
  },
  {
    id: 'why-dbms',
    title: 'Why DBMS Exists',
    fullPath: majorPath,
    user: `Explain why a database management system (DBMS) exists to a beginner who has only stored information in variables, text files, and spreadsheets.
Target understanding: the formal role of a database and DBMS, why persistence alone is insufficient, and how querying, integrity, concurrency, and recovery solve real data-management problems.`,
  },
]

const results = []
for (const topic of topics) {
  const fullSystem = `${shared}\n\n${topic.fullPath}\n\n${commonContract}`
  const rows = await Promise.all([
    callOpenAI({ system: variants.minimal, user: topic.user }),
    callOpenAI({ system: fullSystem, user: topic.user }),
    callOpenAI({ system: variants.compressed, user: topic.user }),
  ])
  for (const [index, variant] of ['minimal', 'full', 'compressed'].entries()) {
    results.push({
      topicId: topic.id,
      topicTitle: topic.title,
      variant,
      text: rows[index].text,
      usage: rows[index].usage,
      latencyMs: rows[index].latencyMs,
      promptCharacters: variant === 'full' ? fullSystem.length : variants[variant].length,
    })
  }
  console.log(`Completed ${topic.title}`)
}

const anonymousLabels = {}
const anonymized = topics.map((topic, topicIndex) => {
  const rows = results.filter((row) => row.topicId === topic.id)
  const order = topicIndex === 0 ? [rows[2], rows[0], rows[1]] : [rows[1], rows[2], rows[0]]
  return {
    topic: topic.title,
    outputs: order.map((row, index) => {
      const label = String.fromCharCode(65 + index)
      anonymousLabels[`${topic.id}:${label}`] = row.variant
      return { label, text: row.text }
    }),
  }
})

const judge = await callOpenAI({
  system: `You are a strict evaluator of educational explanations. Judge writing quality, not prompt complexity. Return valid JSON only.

For every output score each criterion from 1-10:
- clarity
- engagement
- formal_accuracy
- mechanism
- example_quality
- focus
- mental_load (higher is better)
- retention

Also provide total as the sum, maximum two strengths, maximum two weaknesses, ranking best-to-worst for each topic, and a one-sentence topic_verdict. Do not infer prompt identity.`,
  user: JSON.stringify({ task: 'Blindly evaluate the three explanations for each topic.', topics: anonymized }),
  json: true,
  maxOutputTokens: 2300,
})

const report = {
  generatedAt: new Date().toISOString(),
  model: 'gpt-5.5',
  results,
  anonymousLabels,
  judging: JSON.parse(judge.text),
  judgeUsage: judge.usage,
  judgeLatencyMs: judge.latencyMs,
}
writeFileSync(resolve('report/teaching-prompt-experiment-gpt-5.5.json'), JSON.stringify(report, null, 2))

const markdown = [
  '# Teaching Prompt Experiment — GPT-5.5',
  '',
  `Model: ${report.model}`,
  `Generated: ${report.generatedAt}`,
  '',
  ...topics.flatMap((topic) =>
    results.filter((row) => row.topicId === topic.id).flatMap((row) => [
      `## ${topic.title} — ${row.variant}`,
      '',
      `Input tokens: ${row.usage.inputTokens} · Output tokens: ${row.usage.outputTokens} · Cached input: ${row.usage.cachedInputTokens} · Latency: ${row.latencyMs} ms`,
      '',
      row.text,
      '',
    ]),
  ),
]
writeFileSync(resolve('report/teaching-prompt-experiment-gpt-5.5.md'), markdown.join('\n'))

console.log('---SUMMARY JSON---')
console.log(JSON.stringify({
  model: report.model,
  metrics: results.map(({ topicTitle, variant, usage, latencyMs, promptCharacters }) => ({
    topicTitle,
    variant,
    usage,
    latencyMs,
    promptCharacters,
  })),
  anonymousLabels,
  judging: report.judging,
}, null, 2))
