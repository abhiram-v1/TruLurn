#!/usr/bin/env node
// One-time live spike: does Gemini's responseJsonSchema actually accept and
// correctly populate the recursive ($ref) curriculum schema? Deliberately
// asks for a tiny curriculum to keep token cost minimal. Not part of the
// automated test suite — requires a real API key and makes real network calls.
//
// Inlines the Gemini request (mirrors lib/ai/gemini/client.ts +
// lib/ai/gemini/generationConfig.ts) instead of importing those files,
// because they use the "@/" path alias for runtime imports, which plain
// node --experimental-strip-types cannot resolve outside the Next.js build.
import { curriculumResponseSchemaForProvider } from '../lib/ai/skills/curriculumSchema.ts'
import { buildSourceCompaction, formatCurriculumEvidence } from '../lib/course-generation/sourceCompaction.ts'

const MODEL = process.argv[2] || 'gemini-3.5-flash'
const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY
if (!API_KEY) {
  console.error('Missing GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY in the environment.')
  process.exit(1)
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

async function callGemini({ system, user, responseSchema }) {
  const response = await fetch(`${GEMINI_ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature: 0.25,
        topP: 0.9,
        responseMimeType: 'application/json',
        // Diagnostic mode: omit responseJsonSchema entirely (no structured-output
        // enforcement) when responseSchema is null, to isolate whether recursion
        // failure is caused by schema-constrained decoding specifically.
        ...(responseSchema ? { responseJsonSchema: responseSchema.schema } : {}),
      },
    }),
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}): ${data?.error?.message ?? JSON.stringify(data)}`)
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim()
  if (!text) throw new Error(`Gemini returned no text. Full response: ${JSON.stringify(data)}`)
  return { text, usage: data.usageMetadata }
}

function flattenTopics(curriculum) {
  const topics = []
  const visit = (topic, depth) => {
    topics.push({ ...topic, _depth: depth })
    for (const child of Array.isArray(topic?.children) ? topic.children : []) visit(child, depth + 1)
  }
  for (const branch of Array.isArray(curriculum?.branches) ? curriculum.branches : []) {
    for (const section of Array.isArray(branch?.sections) ? branch.sections : []) {
      for (const topic of Array.isArray(section?.topics) ? section.topics : []) visit(topic, 0)
    }
  }
  return topics
}

async function spikeSourceGrounded() {
  console.log(`\n=== SOURCE-GROUNDED schema vs ${MODEL} ===`)
  const sourceText = `Source 1: Locking Basics
# Shared Locks
A shared lock lets multiple transactions read the same row at once but blocks any writer.
# Exclusive Locks
An exclusive lock blocks every other reader and writer until it is released.`

  const compact = await buildSourceCompaction({ sourceTextFallback: sourceText })
  const evidence = formatCurriculumEvidence(compact)
  const schema = curriculumResponseSchemaForProvider('gemini', 'source_grounded')

  const system = 'You build TruLurn curricula. Return only JSON matching the supplied schema.'
  const user = `Build a tiny curriculum from this evidence. Exactly 1 branch, 1 section, 1 top-level topic titled "Locking Basics".

The "Locking Basics" topic's "children" array is MANDATORY and MUST contain exactly 2 child topic objects:
child 1 titled "Shared Locks" and child 2 titled "Exclusive Locks". Each child must itself have an empty
children array ([]). Do NOT represent these as sibling top-level topics or as prerequisites — they MUST be
nested inside "Locking Basics".children. A response with "Locking Basics".children == [] is WRONG and will
be rejected.

Every topic (including children) must cite real section IDs from the evidence in source_refs.

Evidence:
${evidence}`

  const { text, usage } = await callGemini({ system, user, responseSchema: schema })
  console.log('--- raw response ---')
  console.log(text)
  console.log('--- token usage ---', usage)

  const curriculum = JSON.parse(text)
  const topics = flattenTopics(curriculum)
  const maxDepth = Math.max(...topics.map((t) => t._depth))
  console.log('--- parsed checks ---')
  console.log('parsed OK: true')
  console.log('topic count:', topics.length)
  console.log('max depth reached (recursion proof):', maxDepth)
  console.log('every topic has source_refs:', topics.every((t) => Array.isArray(t.source_refs) && t.source_refs.length > 0))
  console.log('every topic has concept_group:', topics.every((t) => typeof t.concept_group === 'string'))
  const sectionIds = new Set(compact.sources.flatMap((s) => s.sections.map((sec) => sec.id)))
  console.log('all source_refs resolve to real section ids:', topics.every((t) => (t.source_refs ?? []).every((r) => sectionIds.has(r))))
  console.log('model omitted hydrated fields (source_anchor/source_coverage/initial_state):',
    topics.every((t) => t.source_anchor === undefined && t.source_coverage === undefined && t.initial_state === undefined))
  console.log('branches omitted state field:', curriculum.branches.every((b) => b.state === undefined))

  if (maxDepth < 1) {
    throw new Error('RECURSION NOT PROVEN: every topic came back at depth 0 (empty children arrays). The $ref schema may be accepted but nested population is unconfirmed.')
  }
}

// Diagnostic: same evidence + same mandate, but with NO responseSchema at all
// (plain prompted JSON via responseMimeType only). Isolates whether nested
// recursion fails because of schema-constrained decoding specifically, or
// for some other reason (e.g. the model just doesn't want to nest here).
async function diagnosePlainPromptedJson() {
  console.log(`\n=== DIAGNOSTIC: same prompt, NO responseSchema (plain JSON mode) vs ${MODEL} ===`)
  const sourceText = `Source 1: Locking Basics
# Shared Locks
A shared lock lets multiple transactions read the same row at once but blocks any writer.
# Exclusive Locks
An exclusive lock blocks every other reader and writer until it is released.`

  const compact = await buildSourceCompaction({ sourceTextFallback: sourceText })
  const evidence = formatCurriculumEvidence(compact)

  const system = `You build TruLurn curricula. Return only JSON, no markdown, no prose outside JSON.
Shape: { branches: [{ id, title, description, sections: [{ title, topics: [{ id, title, description, source_refs: [string], concept_group, children: [<same topic shape, recursively>] }] }] }] }`
  const user = `Build a tiny curriculum from this evidence. Exactly 1 branch, 1 section, 1 top-level topic titled "Locking Basics".

The "Locking Basics" topic's "children" array is MANDATORY and MUST contain exactly 2 child topic objects:
child 1 titled "Shared Locks" and child 2 titled "Exclusive Locks". Each child must itself have an empty
children array ([]). Do NOT represent these as sibling top-level topics or as prerequisites — they MUST be
nested inside "Locking Basics".children. A response with "Locking Basics".children == [] is WRONG and will
be rejected.

Every topic (including children) must cite real section IDs from the evidence in source_refs.

Evidence:
${evidence}`

  const { text, usage } = await callGemini({ system, user, responseSchema: null })
  console.log('--- raw response ---')
  console.log(text)
  console.log('--- token usage ---', usage)

  const curriculum = JSON.parse(text)
  const topics = flattenTopics(curriculum)
  const maxDepth = Math.max(...topics.map((t) => t._depth))
  console.log('--- parsed checks ---')
  console.log('parsed OK: true')
  console.log('topic count:', topics.length)
  console.log('max depth reached (recursion proof):', maxDepth)
  return maxDepth
}

async function spikeAiTeacher() {
  console.log(`\n=== AI-TEACHER schema vs ${MODEL} ===`)
  const schema = curriculumResponseSchemaForProvider('gemini', 'ai_teacher')
  const system = 'You build TruLurn curricula. Return only JSON matching the supplied schema.'
  const user = `Build a tiny curriculum for "Knot tying basics". Exactly 1 branch, 1 section, 2 topics.
The first topic must have exactly 1 child topic (to test nested recursion). The second topic has 0 children.`

  const { text, usage } = await callGemini({ system, user, responseSchema: schema })
  console.log('--- raw response ---')
  console.log(text)
  console.log('--- token usage ---', usage)

  const curriculum = JSON.parse(text)
  const topics = flattenTopics(curriculum)
  console.log('--- parsed checks ---')
  console.log('parsed OK: true')
  console.log('topic count:', topics.length)
  console.log('max depth reached (recursion proof):', Math.max(...topics.map((t) => t._depth)))
  console.log('model omitted source-only fields (source_refs/concept_group):',
    topics.every((t) => t.source_refs === undefined && t.concept_group === undefined))
}

try {
  const depth = await diagnosePlainPromptedJson()
  if (depth >= 1) {
    console.log('\n=== DIAGNOSTIC RESULT: nesting WORKS without responseSchema — schema-constrained decoding is the likely blocker ===')
  } else {
    console.log('\n=== DIAGNOSTIC RESULT: nesting STILL FAILS without responseSchema — not a schema-decoding issue specifically ===')
  }
} catch (error) {
  console.error('\n=== DIAGNOSTIC RESULT: FAIL (request error) ===')
  console.error(error)
  process.exitCode = 1
}
