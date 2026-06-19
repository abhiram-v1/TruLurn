import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(path) {
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const split = trimmed.indexOf('=')
    if (split < 1) continue
    const key = trimmed.slice(0, split).trim()
    let value = trimmed.slice(split + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
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

loadEnv(resolve('.env.local'))

const personaSource = readFileSync(resolve('lib/personas/immersiveBuilder.ts'), 'utf8')
const shared = extractTemplate(personaSource, 'SHARED', '\n\nconst LESSON_PATHS')
const majorMatch = personaSource.match(/major_concept:\s*`([\s\S]*?)`,\s*\n\s*technical:/)
if (!majorMatch) throw new Error('Could not find the major-concept lesson path')

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('No OpenAI API key is configured')
const model = process.env.AI_FEATURE_TOPIC_PAGE_GENERATION_MODEL
  ?? process.env.OPENAI_LESSON_MODEL
  ?? process.env.OPENAI_PRIMARY_MODEL
  ?? 'gpt-5.4'

const system = `${shared}

${majorMatch[1].trim()}

COURSE AND PAGE CONTRACT:
- This is a beginner-friendly Data Science course.
- Stay strictly within two concepts: data, then data science.
- Preserve the course order. Do not introduce a broader syllabus, career roadmap, tools survey, or history.
- Produce a short but complete lesson page in Markdown.
- Teach with intellectual energy and care, but no hype.
- Include precise, academically reliable definitions for both "data" and "data science".
- Unpack both definitions in plain language.
- Use one coherent example to connect raw observations to a data-science question.
- After the heading, use at most two short opening paragraphs and reach the first definition within roughly 150 words.
- Put each formal definition in a visible blockquote callout using > **Definition:**.
- Finish with one compact blockquote callout using > **Remember:** or > **TL;DR:** for quick memory retention. Preserve the formal definitions and no more than three load-bearing points. Never label it for exams or interviews.
- Do not mention these instructions or any source.`

const user = `Write the lesson page now.

Topic: Foundations of Data Science
Page focus, in order:
1. What is data?
2. What is data science?

Target understanding:
The learner should understand data as recorded representations of observations or measurements, then see data science as the disciplined, interdisciplinary process of using data to produce reliable understanding and support decisions.

Length: approximately 550-750 words.`

const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    reasoning: { effort: 'low' },
    max_output_tokens: 1800,
  }),
})

const payload = await response.json()
if (!response.ok) {
  throw new Error(payload?.error?.message ?? `OpenAI request failed (${response.status})`)
}

const output = payload?.output_text?.trim() || payload?.output
  ?.flatMap((item) => item.content ?? [])
  .map((part) => part.text ?? '')
  .join('\n')
  .trim()
if (!output) throw new Error('OpenAI returned an empty response')

console.log(`MODEL: ${model}`)
console.log('---BEGIN OUTPUT---')
console.log(output)
console.log('---END OUTPUT---')
