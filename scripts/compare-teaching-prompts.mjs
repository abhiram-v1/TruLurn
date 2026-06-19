import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

function loadEnv(path) {
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
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

async function callOpenAI({ system, user, maxOutputTokens = 1500, json = false }) {
  const started = performance.now()
  const body = {
    model,
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
      Authorization: `Bearer ${apiKey}`,
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
    },
  }
}

loadEnv(resolve('.env.local'))

const personaSource = readFileSync(resolve('lib/personas/immersiveBuilder.ts'), 'utf8')
const shared = extractTemplate(personaSource, 'SHARED', '\n\nconst LESSON_PATHS')
const majorPath = extractPath(personaSource, 'major_concept', 'technical')
const mathematicalPath = extractPath(personaSource, 'mathematical', '\\}\\n\\nconst SURFACE_DIRECTIVES')

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('No OpenAI API key is configured')
const model = process.env.AI_FEATURE_TOPIC_PAGE_GENERATION_MODEL
  ?? process.env.OPENAI_LESSON_MODEL
  ?? process.env.OPENAI_PRIMARY_MODEL
  ?? 'gpt-5.4'

const commonContract = `OUTPUT CONTRACT:
- Write one self-contained beginner-friendly lesson in Markdown, approximately 500-700 words.
- Give a precise, academically reliable definition early.
- Explain the intuition and mechanism, not merely a list of facts.
- Work through one concrete example.
- Name one important boundary or common misunderstanding.
- End with a compact > **Remember:** summary.
- Do not mention prompts, sources, exams, or interviews.`

const variants = {
  minimal: `Act like an enthusiastic university professor. Explain the assigned concept clearly to a beginner. Include its formal definition, intuition, mechanism, one concrete example, one important limitation or misunderstanding, and a short final summary. Be engaging without hype.\n\n${commonContract}`,
  full: `${shared}\n\n${majorPath}\n\n${commonContract}`,
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
    user: `Explain gradient descent to a beginner who understands basic algebra but has not studied calculus deeply.
Target understanding: why optimization is needed, what the gradient represents, how the update rule moves parameters, the role of learning rate, and why gradient descent can fail or behave poorly.`,
  },
  {
    id: 'why-databases',
    title: 'Why Databases Exist',
    user: `Explain why databases exist to a beginner who has only stored information in variables, text files, and spreadsheets.
Target understanding: the formal role of a database and DBMS, why persistence alone is insufficient, and how querying, integrity, concurrency, and recovery solve real data-management problems.`,
  },
  {
    id: 'why-neural-networks',
    title: 'Why Neural Networks',
    user: `Explain why neural networks are useful to a beginner who understands ordinary computer programs and simple linear models.
Target understanding: what a neural network formally is, why layered nonlinear transformations matter, how learning replaces hand-written feature rules, one concrete example, and an important limitation.`,
  },
]

const results = []
for (const topic of topics) {
  const topicResults = await Promise.all(
    Object.entries(variants).map(async ([variant, system]) => ({
      topicId: topic.id,
      topicTitle: topic.title,
      variant,
      ...(await callOpenAI({
        system: variant === 'full' && topic.id === 'gradient-descent'
          ? `${shared}\n\n${mathematicalPath}\n\n${commonContract}`
          : system,
        user: topic.user,
      })),
    })),
  )
  results.push(...topicResults)
  console.log(`Completed ${topic.title}`)
}

const anonymousLabels = new Map()
const anonymized = topics.map((topic, topicIndex) => {
  const topicRows = results.filter((row) => row.topicId === topic.id)
  const order = topicIndex % 2 === 0
    ? [topicRows[1], topicRows[2], topicRows[0]]
    : [topicRows[2], topicRows[0], topicRows[1]]
  return {
    topic: topic.title,
    outputs: order.map((row, index) => {
      const label = String.fromCharCode(65 + index)
      anonymousLabels.set(`${topic.id}:${label}`, row.variant)
      return { label, text: row.text }
    }),
  }
})

const judgeSystem = `You are a strict evaluator of educational explanations. Judge writing quality, not prompt complexity. Return valid JSON only.

For every output score each criterion from 1-10:
- clarity: easy to follow without oversimplifying
- engagement: intellectual energy and human teaching presence without hype
- formal_accuracy: precise definition and academically reliable terminology
- mechanism: explains how or why the concept works
- example_quality: concrete example genuinely teaches the mechanism
- focus: stays on the assigned concept without unnecessary material
- mental_load: well paced and scannable; higher is better
- retention: leaves a durable mental model and useful summary

Also provide:
- total: sum of the eight scores
- strengths: maximum two short strings
- weaknesses: maximum two short strings
- ranking: labels best to worst for that topic
- topic_verdict: one concise sentence

Do not infer which prompt produced an output.`

const judgeUser = JSON.stringify({
  task: 'Blindly evaluate the three explanations for each topic.',
  topics: anonymized,
})

const judged = await callOpenAI({
  system: judgeSystem,
  user: judgeUser,
  maxOutputTokens: 3500,
  json: true,
})
const judging = JSON.parse(judged.text)

const report = {
  generatedAt: new Date().toISOString(),
  model,
  variants: Object.fromEntries(Object.entries(variants).map(([key, value]) => [key, { promptCharacters: value.length }])),
  results,
  anonymousLabels: Object.fromEntries(anonymousLabels),
  judging,
  judgeUsage: judged.usage,
  judgeLatencyMs: judged.latencyMs,
}

writeFileSync(resolve('report/teaching-prompt-experiment.json'), JSON.stringify(report, null, 2))

const markdown = [
  '# Teaching Prompt Experiment',
  '',
  `Model: ${model}`,
  `Generated: ${report.generatedAt}`,
  '',
  ...topics.flatMap((topic) => {
    const topicRows = results.filter((row) => row.topicId === topic.id)
    return [
      `## ${topic.title}`,
      '',
      ...topicRows.flatMap((row) => [
        `### ${row.variant}`,
        '',
        `Input tokens: ${row.usage.inputTokens} · Output tokens: ${row.usage.outputTokens} · Latency: ${row.latencyMs} ms`,
        '',
        row.text,
        '',
      ]),
    ]
  }),
]
writeFileSync(resolve('report/teaching-prompt-experiment.md'), markdown.join('\n'))

console.log(`MODEL: ${model}`)
console.log('---SUMMARY JSON---')
console.log(JSON.stringify({
  variants: report.variants,
  metrics: results.map(({ topicTitle, variant, usage, latencyMs }) => ({ topicTitle, variant, usage, latencyMs })),
  anonymousLabels: report.anonymousLabels,
  judging,
}, null, 2))
