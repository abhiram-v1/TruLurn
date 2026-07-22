import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expandMarkdownSelectionToSentence,
  projectMarkdownText,
  replaceMarkdownSelection,
  resolveMarkdownSelection,
} from './markdown-selection.ts'

test('replaces rendered text inside bold and inline-code Markdown in place', () => {
  const source = 'NumPy stores the **scalar value `3`** as a 64-bit integer.'
  const result = replaceMarkdownSelection(
    source,
    { text: 'scalar value 3' },
    'single number three',
  )

  assert.ok(result)
  assert.equal(result.value, 'NumPy stores the single number three as a 64-bit integer.')
})

test('replaces a fully selected formatted phrase without trapping rich output in formatting', () => {
  const source = 'This is **important context** for the next step.'
  const result = replaceMarkdownSelection(
    source,
    { text: 'important context' },
    'A clearer explanation.\n\nA second paragraph.',
  )

  assert.ok(result)
  assert.equal(result.value, 'This is A clearer explanation.\n\nA second paragraph. for the next step.')
})

test('maps link labels to the complete Markdown link source range', () => {
  const source = 'Read the [NumPy scalar guide](https://numpy.org/guide) before continuing.'
  const match = resolveMarkdownSelection(source, { text: 'NumPy scalar guide' })

  assert.ok(match)
  assert.equal(match.markdown, '[NumPy scalar guide](https://numpy.org/guide)')
})

test('uses nearby rendered context to disambiguate repeated selections', () => {
  const source = 'First, **scale the value** for storage. Later, scale the value for display.'
  const result = replaceMarkdownSelection(
    source,
    {
      text: 'scale the value',
      before: 'First,',
      after: 'for storage. Later, scale the value for display.',
    },
    'multiply the magnitude',
  )

  assert.ok(result)
  assert.equal(result.value, 'First, multiply the magnitude for storage. Later, scale the value for display.')
})

test('normalizes browser whitespace while preserving the exact source span', () => {
  const source = 'A sentence ends here.\n\nThe next sentence has `inline code`.'
  const result = replaceMarkdownSelection(
    source,
    { text: 'sentence ends here. The next sentence' },
    'idea flows into the next sentence',
  )

  assert.ok(result)
  assert.equal(result.value, 'A idea flows into the next sentence has `inline code`.')
})

test('does not guess when duplicate text has no distinguishing context', () => {
  const source = 'Value means magnitude. Value also means stored data.'
  assert.equal(resolveMarkdownSelection(source, { text: 'Value' }), null)
})

test('projects headings, lists, blockquotes, emphasis, and links as rendered text', () => {
  const source = '# Heading\n\n- **Bold** and [linked](https://example.com)\n\n> Quoted text'
  assert.equal(projectMarkdownText(source).text, 'Heading Bold and linked Quoted text')
})

test('expands a formatted inline fragment to its containing sentence', () => {
  const source = 'Earlier context. NumPy stores the **scalar value `3`** as a 64-bit integer. Later context.'
  const expanded = expandMarkdownSelectionToSentence(source, {
    text: 'scalar value 3',
    before: 'Earlier context. NumPy stores the',
    after: 'as a 64-bit integer. Later context.',
  })

  assert.deepEqual(expanded, {
    text: 'NumPy stores the scalar value 3 as a 64-bit integer.',
    before: 'Earlier context.',
    after: 'Later context.',
  })
})

test('sentence expansion stays inside the current Markdown paragraph', () => {
  const source = '- A list item with **one value** and no period.\n\n## Next heading\n\nMore text.'
  const expanded = expandMarkdownSelectionToSentence(source, { text: 'one value' })
  assert.equal(expanded?.text, 'A list item with one value and no period.')
})
