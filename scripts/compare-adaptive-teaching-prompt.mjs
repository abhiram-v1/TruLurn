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

async function callOpenAI({ system, user, maxOutputTokens = 1600, json = false, reasoning = 'low' }) {
  const started = performance.now()
  const body = {
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    reasoning: { effort: reasoning },
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

function usageSum(...items) {
  return items.reduce((sum, item) => ({
    inputTokens: sum.inputTokens + item.usage.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + item.usage.cachedInputTokens,
    outputTokens: sum.outputTokens + item.usage.outputTokens,
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })
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

const plannerSystem = `You are TruLurn's lesson-planning policy. Select compact teaching metadata before lesson generation.
Return valid JSON only with exactly these fields:
{
  "learner_level": "beginner",
  "strategy": "immersive_builder",
  "page_type": "introduction" | "technical" | "mathematical",
  "depth": 1 | 2 | 3 | 4 | 5,
  "importance": "supporting" | "standard" | "important" | "critical",
  "target_words": integer from 350 to 850,
  "max_output_tokens": integer from 900 to 1900,
  "formalism": "light" | "moderate" | "rigorous",
  "example_count": 1 | 2,
  "include_misconception": boolean,
  "reason": one sentence
}

Policy:
- Learner level and strategy are fixed as supplied.
- Depth measures conceptual mastery required, not writing length alone.
- Use depth 5 only for a course-critical idea whose mechanism and boundaries must be mastered.
- Mathematical notation raises formalism and may raise token budget, but do not inflate prose.
- Prefer the smallest target and ceiling that can teach the concept completely.`

const compressedBase = `TEACHING STRATEGY: Immersive Builder
Teach like a warm professor with genuine intellectual interest. Reveal what problem the idea resolves and what mechanism makes it work. Excitement comes from insight, not hype.

NON-NEGOTIABLES:
- Preserve canonical definitions, terminology, notation, assumptions, boundaries, and course scope.
- Reach the governing idea or definition early. Put the formal definition in > **Definition:**.
- Unpack the definition in connected prose, then explain the mechanism causally.
- Use concrete examples only when they perform teaching work; explicitly connect each part to the concept.
- End a completed concept with a compact > **Remember:** containing the definition and at most three durable points.
- Avoid source-report language, generic filler, repeated explanations, unnecessary taxonomies, and exam/interview labels.

Use the supplied metadata as a proportionality policy:
- depth 1-2: concise support; one definition or distinction and the smallest useful example.
- depth 3: standard complete explanation with mechanism and one boundary.
- depth 4: foundational treatment with formalism, worked example, misconception, and consequence.
- depth 5: mastery treatment; expose mechanism, assumptions, failure conditions, and transfer while remaining focused.
- Respect target_words as a target and max_output_tokens as a hard ceiling.`

const fullContract = `OUTPUT CONTRACT:
- Write one self-contained beginner-friendly lesson in Markdown.
- Give a precise, academically reliable definition early.
- Explain the intuition and mechanism.
- Work through a concrete example.
- Name an important boundary or common misunderstanding.
- End with a compact > **Remember:** summary.
- Do not mention prompts, sources, exams, or interviews.`

const topics = [
  {
    id: 'gradient-descent',
    title: 'Gradient Descent',
    pageType: 'mathematical',
    user: `Explain gradient descent to a beginner who understands basic algebra but has not studied calculus deeply.
Target understanding: why optimization is needed, what the gradient represents, how the update rule moves parameters, the role of learning rate, and why gradient descent can fail or behave poorly.`,
  },
  {
    id: 'why-databases',
    title: 'Why Databases Exist',
    pageType: 'introduction',
    user: `Explain why databases exist to a beginner who has only stored information in variables, text files, and spreadsheets.
Target understanding: the formal role of a database and DBMS, why persistence alone is insufficient, and how querying, integrity, concurrency, and recovery solve real data-management problems.`,
  },
  {
    id: 'why-neural-networks',
    title: 'Why Neural Networks',
    pageType: 'introduction',
    user: `Explain why neural networks are useful to a beginner who understands ordinary computer programs and simple linear models.
Target understanding: what a neural network formally is, why layered nonlinear transformations matter, how learning replaces hand-written feature rules, one concrete example, and an important limitation.`,
  },
]

const results = []
for (const topic of topics) {
  const fullPromise = callOpenAI({
    system: `${shared}\n\n${topic.pageType === 'mathematical' ? mathematicalPath : majorPath}\n\n${fullContract}`,
    user: `${topic.user}\n\nLength: approximately 500-700 words.`,
  })

  const planner = await callOpenAI({
    system: plannerSystem,
    user: JSON.stringify({
      learner_level: 'beginner',
      strategy: 'immersive_builder',
      concept: topic.title,
      requested_outcome: topic.user,
    }),
    maxOutputTokens: 500,
    json: true,
    reasoning: 'low',
  })
  const metadata = JSON.parse(planner.text)
  const adaptive = await callOpenAI({
    system: `${compressedBase}\n\nSELECTED METADATA:\n${JSON.stringify(metadata, null, 2)}`,
    user: topic.user,
    maxOutputTokens: Math.max(900, Math.min(1900, Number(metadata.max_output_tokens) || 1400)),
  })
  const full = await fullPromise

  results.push(
    {
      topicId: topic.id,
      topicTitle: topic.title,
      variant: 'full',
      metadata: null,
      text: full.text,
      usage: full.usage,
      latencyMs: full.latencyMs,
      generationLatencyMs: full.latencyMs,
      plannerLatencyMs: 0,
    },
    {
      topicId: topic.id,
      topicTitle: topic.title,
      variant: 'adaptive_compressed',
      metadata,
      text: adaptive.text,
      usage: usageSum(planner, adaptive),
      plannerUsage: planner.usage,
      generationUsage: adaptive.usage,
      latencyMs: planner.latencyMs + adaptive.latencyMs,
      plannerLatencyMs: planner.latencyMs,
      generationLatencyMs: adaptive.latencyMs,
    },
  )
  console.log(`Completed ${topic.title}: ${JSON.stringify(metadata)}`)
}

const anonymousLabels = {}
const anonymized = topics.map((topic, index) => {
  const rows = results.filter((row) => row.topicId === topic.id)
  const order = index % 2 === 0 ? [rows[1], rows[0]] : [rows[0], rows[1]]
  return {
    topic: topic.title,
    outputs: order.map((row, outputIndex) => {
      const label = String.fromCharCode(65 + outputIndex)
      anonymousLabels[`${topic.id}:${label}`] = row.variant
      return { label, text: row.text }
    }),
  }
})

const judge = await callOpenAI({
  system: `Blindly evaluate educational explanations. Return valid JSON only.
For each output score 1-10: clarity, engagement, formal_accuracy, mechanism, example_quality, focus, mental_load, retention.
Include total as the sum, at most two strengths, at most two weaknesses, a best-to-worst ranking, and one-sentence topic_verdict.
Judge writing quality only; do not infer prompt identity.`,
  user: JSON.stringify({ topics: anonymized }),
  maxOutputTokens: 2800,
  json: true,
})

const report = {
  generatedAt: new Date().toISOString(),
  model,
  results,
  anonymousLabels,
  judging: JSON.parse(judge.text),
  judgeUsage: judge.usage,
  judgeLatencyMs: judge.latencyMs,
}
writeFileSync(resolve('report/adaptive-teaching-prompt-experiment.json'), JSON.stringify(report, null, 2))

const markdown = [
  '# Adaptive Teaching Prompt Experiment',
  '',
  `Model: ${model}`,
  `Generated: ${report.generatedAt}`,
  '',
  ...topics.flatMap((topic) =>
    results.filter((row) => row.topicId === topic.id).flatMap((row) => [
      `## ${topic.title} — ${row.variant}`,
      '',
      row.metadata ? `Metadata:\n\n\`\`\`json\n${JSON.stringify(row.metadata, null, 2)}\n\`\`\`` : 'Metadata: none; current full prompt path.',
      '',
      `Input tokens: ${row.usage.inputTokens} · Output tokens: ${row.usage.outputTokens} · Total latency: ${row.latencyMs} ms`,
      '',
      row.text,
      '',
    ]),
  ),
]
writeFileSync(resolve('report/adaptive-teaching-prompt-experiment.md'), markdown.join('\n'))

console.log('---SUMMARY JSON---')
console.log(JSON.stringify({
  model,
  metrics: results.map(({ topicTitle, variant, metadata, usage, latencyMs, plannerLatencyMs, generationLatencyMs }) => ({
    topicTitle,
    variant,
    metadata,
    usage,
    latencyMs,
    plannerLatencyMs,
    generationLatencyMs,
  })),
  anonymousLabels,
  judging: report.judging,
}, null, 2))
