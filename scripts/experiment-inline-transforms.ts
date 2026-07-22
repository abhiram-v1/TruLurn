import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd(), true, console, true)

const { generateAI, parseAIJson } = await import('../lib/ai/index.ts')
const { expandMarkdownSelectionToSentence, replaceMarkdownSelection } = await import('../lib/markdown-selection.ts')
const {
  buildTransformUserPrompt,
  buildTransformSystem,
  validateTransformResult,
} = await import('../lib/topic-transform.ts')

const source = `Scalar operations manipulate **one magnitude**, and NumPy can represent scalar values with specific numeric types; these scalar values later become entries, coefficients, and scaling factors in vectors and matrices. This is why scalar types matter in numerical code.`
const selection = {
  text: 'one magnitude',
  before: 'Scalar operations manipulate',
  after: 'and NumPy can represent scalar values with specific numeric types; these scalar values later become entries, coefficients, and scaling factors in vectors and matrices.',
}
const actions = ['simplify', 'deeper', 'example'] as const
const candidates: Array<{ action: typeof actions[number]; result: string; page: string }> = []
const preparedSelection = expandMarkdownSelectionToSentence(source, selection)
if (!preparedSelection) throw new Error('Could not expand the fixture selection to its containing sentence.')

for (const action of actions) {
  const prompt = buildTransformUserPrompt({
    action,
    selectedText: preparedSelection.text,
    topicTitle: 'Scalar arithmetic and NumPy scalar types',
    contextBefore: preparedSelection.before,
    contextAfter: preparedSelection.after,
  })
  let repair = ''
  let accepted: { result: string; page: string } | null = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = (await generateAI({
      feature: 'topic_transform',
      system: buildTransformSystem(action),
      user: `${prompt}${repair}`,
      responseMimeType: 'text/plain',
    })).trim()
    const issues = validateTransformResult(action, preparedSelection.text, result, {
      before: preparedSelection.before,
      after: preparedSelection.after,
    })
    const applied = replaceMarkdownSelection(source, preparedSelection, result)
    if (!applied) throw new Error(`${action}: generated text could not be reinserted into Markdown.`)
    if (issues.length === 0) {
      accepted = { result, page: applied.value }
      break
    }
    repair = `\n\nRepair these failed checks:\n${issues.map((issue) => `- ${issue}`).join('\n')}\nReturn only the corrected replacement.`
  }

  if (!accepted) throw new Error(`${action}: exhausted quality-repair attempts.`)
  candidates.push({ action, ...accepted })
}

const reviewSystem = `Review three inline lesson replacement strings. The user's short fragment has been expanded to its complete containing sentence before generation. Every result must be a grammatically complete substitute for selectedText.
Simplify must preserve the concept in plainer language. Deeper must explain an underlying mechanism. Example must preserve the concept and integrate one concrete case.
Reject preambles, off-topic additions, broken sentence flow, and malformed Markdown. The surrounding page has already been verified separately and is intentionally omitted. Return JSON only.`
const reviewInput = JSON.stringify({
  selectedText: preparedSelection.text,
  replacements: candidates.map(({ action, result }) => ({ action, result })),
})
type Review = { accepted: boolean; results: Array<{ action: string; accepted: boolean; reason: string }> }
let review: Review | null = null
let invalidReview = ''
for (let attempt = 1; attempt <= 2; attempt += 1) {
  const reviewRaw = await generateAI({
    feature: 'page_analysis',
    system: reviewSystem,
    user: `${reviewInput}${invalidReview}`,
    responseMimeType: 'text/plain',
    responseSchema: {
      name: 'inline_transform_experiment_review',
      schema: {
        type: 'object',
        properties: {
          accepted: { type: 'boolean' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                accepted: { type: 'boolean' },
                reason: { type: 'string' },
              },
              required: ['action', 'accepted', 'reason'],
            },
          },
        },
        required: ['accepted', 'results'],
      },
    },
  })
  const parsed = parseAIJson<Partial<Review>>(reviewRaw)
  if (typeof parsed.accepted === 'boolean' && Array.isArray(parsed.results) && parsed.results.length === actions.length) {
    review = parsed as Review
    break
  }
  invalidReview = '\n\nYour previous JSON was missing accepted or exactly three result objects. Return the required schema only.'
}
if (!review) throw new Error('Semantic reviewer returned an invalid schema twice.')
if (!review.accepted || review.results.some((result) => !result.accepted)) {
  throw new Error(`Semantic review failed: ${JSON.stringify({ candidates, review: review.results })}`)
}

console.log(JSON.stringify({ passed: true, candidates, review: review.results }, null, 2))
