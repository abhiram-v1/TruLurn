import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTransformSystem, buildTransformUserPrompt, validateTransformResult } from './topic-transform.ts'

test('transform prompt marks surrounding text as immutable context', () => {
  const prompt = buildTransformUserPrompt({
    action: 'simplify',
    selectedText: 'A scalar is a rank-zero tensor.',
    topicTitle: 'NumPy scalars',
    contextBefore: 'In numerical computing,',
    contextAfter: 'It stores one value.',
  })

  assert.match(prompt, /context only; do not rewrite/i)
  assert.match(prompt, /<selected_passage>\nA scalar is a rank-zero tensor\.\n<\/selected_passage>/)
  assert.match(prompt, /Return only the replacement/)
})

test('quality checks reject preambles and shallow deeper responses', () => {
  const issues = validateTransformResult(
    'deeper',
    'A scalar stores one value in a fixed-width numeric representation for later computation.',
    'Here is the expanded version: A scalar stores one value.',
  )
  assert.ok(issues.some((issue) => /preamble/i.test(issue)))
  assert.ok(issues.some((issue) => /deeper/i.test(issue)))
})

test('quality checks accept an integrated concrete example', () => {
  const issues = validateTransformResult(
    'example',
    'A scalar changes magnitude.',
    'A scalar changes magnitude without adding a new direction. For example, multiplying a 3-meter vector by 2 changes its length to 6 meters while its direction stays fixed.',
  )
  assert.deepEqual(issues, [])
})

test('transform system requires the renderer-compatible math delimiters', () => {
  const system = buildTransformSystem('deeper')
  assert.match(system, /Use \$\.\.\.\$ for every inline formula/)
  assert.ok(system.includes('Never use \\(...\\) or \\[...\\]'))
  assert.match(system, /Never invent a callout, panel, card label/i)
})

test('transform quality checks prevent helpers from inventing lesson cards', () => {
  const invented = validateTransformResult(
    'example',
    'A scalar changes magnitude.',
    '> **Pro tip:** A scalar changes magnitude. For example, multiplying 3 by 2 produces 6.',
  )
  assert.ok(invented.some((issue) => /never invent a card|renderer-owned/i.test(issue)))

  const introduced = validateTransformResult(
    'example',
    'A scalar changes magnitude.',
    '> **Example:** A scalar changes magnitude. Multiplying 3 by 2 produces 6.',
  )
  assert.ok(introduced.some((issue) => /Do not introduce a card/i.test(issue)))
})

test('transform quality checks preserve an existing sanctioned card label', () => {
  const issues = validateTransformResult(
    'simplify',
    '> **Definition:** A scalar is a rank-zero tensor that stores one value.',
    '> **Definition:** A scalar is a tensor that stores just one value.',
  )
  assert.ok(!issues.some((issue) => /card/i.test(issue)))
})

test('quality checks reject unsupported LaTeX delimiters and mixed display fences', () => {
  const unsupported = validateTransformResult(
    'deeper',
    'A scalar belongs to the real numbers.',
    'A scalar belongs to \\(\\mathbb{R}\\), which is closed under addition and multiplication.',
  )
  assert.ok(unsupported.some((issue) => /never use/i.test(issue)))

  const mixedFence = validateTransformResult(
    'deeper',
    'The sum has a closed form.',
    'The sum has a closed form because $$\\sum_{i=1}^{n} i = n(n+1)/2$$ follows by pairing terms.',
  )
  assert.ok(mixedFence.some((issue) => /own line/i.test(issue)))
})
