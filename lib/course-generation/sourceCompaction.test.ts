import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSourceCompaction,
  deriveSourceAnchor,
  formatCurriculumEvidence,
  formatProfileOutline,
  indexCompactSections,
} from './sourceCompaction.ts'

function makeSection(i: number, paraChars: number): string {
  const filler = `This section explains concept number ${i} in concrete, narrative detail. `
  let para = ''
  while (para.length < paraChars) para += filler
  return `# Section ${i}: Topic ${i}\n${para.slice(0, paraChars)}`
}

function makeSource(sectionCount: number, paraChars: number): string {
  const parts: string[] = []
  for (let i = 1; i <= sectionCount; i++) parts.push(makeSection(i, paraChars))
  return parts.join('\n\n')
}

test('compact mode enforces the 20k character budget', async () => {
  const text = makeSource(80, 700) // ~58k chars → compact mode
  const compact = await buildSourceCompaction({ sourceTextFallback: text })

  assert.ok(compact.original_char_count > 25000 && compact.original_char_count <= 120000)
  assert.equal(compact.coverage_report.budget_chars, 20000)
  assert.ok(
    compact.compact_char_count <= 20000,
    `compact_char_count ${compact.compact_char_count} exceeds 20k budget`,
  )
  assert.equal(compact.coverage_report.within_budget, true)
  assert.ok(compact.coverage_report.trimmed_section_count > 0)
})

test('budget is allocated fairly so no section is starved', async () => {
  const text = makeSource(80, 700)
  const compact = await buildSourceCompaction({ sourceTextFallback: text })

  const sections = compact.sources[0].sections
  assert.equal(sections.length, 80)
  for (const sec of sections) {
    const size = sec.opening_excerpt.length + sec.key_definitions.join('').length
    assert.ok(size > 0, 'every section retains some evidence after budgeting')
  }
})

test('hierarchical mode enforces the 30k character budget', async () => {
  const text = makeSource(400, 350) // ~150k chars → hierarchical mode
  const compact = await buildSourceCompaction({ sourceTextFallback: text })

  assert.ok(compact.original_char_count > 120000)
  assert.equal(compact.coverage_report.budget_chars, 30000)
  assert.ok(
    compact.compact_char_count <= 30000,
    `compact_char_count ${compact.compact_char_count} exceeds 30k budget`,
  )
  assert.equal(compact.coverage_report.within_budget, true)
  assert.equal(compact.sources[0].sections.length, 400)
})

test('small sources keep full evidence with no budget enforcement', async () => {
  const text = makeSource(10, 400) // ~4.3k chars → full mode
  const compact = await buildSourceCompaction({ sourceTextFallback: text })

  assert.ok(compact.original_char_count <= 25000)
  assert.equal(compact.coverage_report.budget_chars, 0)
  assert.equal(compact.coverage_report.within_budget, true)
  assert.equal(compact.coverage_report.trimmed_section_count, 0)
  assert.ok(compact.sources[0].sections[0].opening_excerpt.length >= 390)
})

test('every source is represented under a shared budget', async () => {
  const text = [makeSource(40, 700), makeSource(40, 700)].join('\n\n---\n\n')
  const compact = await buildSourceCompaction({ sourceTextFallback: text })

  assert.equal(compact.coverage_report.source_count, 2)
  assert.equal(compact.coverage_report.represented_source_count, 2)
  assert.ok(compact.compact_char_count <= 20000)
  for (const src of compact.sources) {
    assert.ok(src.sections.length > 0, 'each source keeps sections')
    const used = src.sections.reduce((acc, s) => acc + s.opening_excerpt.length, 0)
    assert.ok(used > 0, 'each source retains evidence after budgeting')
  }
})

test('sections carry stable s{source}:{section} ids', async () => {
  const text = [makeSource(3, 400), makeSource(2, 400)].join('\n\n---\n\n')
  const compact = await buildSourceCompaction({ sourceTextFallback: text })

  const allIds = compact.sources.flatMap((s) => s.sections.map((sec) => sec.id))
  assert.ok(allIds.length > 0)
  for (const id of allIds) assert.match(id, /^s\d+:\d+$/)
  assert.equal(new Set(allIds).size, allIds.length, 'ids are unique')
  assert.ok(compact.sources[0].sections.every((sec) => sec.id.startsWith('s1:')))
  assert.ok(compact.sources[1].sections.every((sec) => sec.id.startsWith('s2:')))
})

test('curriculum evidence projection embeds section ids', async () => {
  const compact = await buildSourceCompaction({ sourceTextFallback: makeSource(3, 400) })
  const evidence = formatCurriculumEvidence(compact)
  assert.match(evidence, /\[s1:1\]/)
  assert.match(evidence, /Excerpt:/)
})

test('profile outline is slimmer than curriculum evidence and capped', async () => {
  const compact = await buildSourceCompaction({ sourceTextFallback: makeSource(80, 700) })
  const outline = formatProfileOutline(compact)
  const evidence = formatCurriculumEvidence(compact)

  assert.ok(outline.length <= 8000, `outline ${outline.length} exceeds 8k cap`)
  assert.ok(outline.length < evidence.length, 'outline is slimmer than evidence')
  assert.match(outline, /\[s1:1\]/)
  assert.doesNotMatch(outline, /Excerpt:/)
})

test('indexCompactSections resolves every section by its stable id', async () => {
  const compact = await buildSourceCompaction({
    sourceTextFallback: [makeSource(3, 200), makeSource(2, 200)].join('\n\n---\n\n'),
  })
  const index = indexCompactSections(compact)

  assert.equal(index.size, 5)
  const hit = index.get('s2:1')
  assert.ok(hit)
  assert.equal(hit?.sourceNumber, 2)
  assert.deepEqual(hit?.section.id, 's2:1')

  assert.equal(index.get('s9:9'), undefined)
  assert.equal(indexCompactSections(null).size, 0)
})

test('deriveSourceAnchor returns a human-readable pointer for the first valid ref', async () => {
  const compact = await buildSourceCompaction({ sourceTextFallback: makeSource(3, 200) })
  const anchor = deriveSourceAnchor(compact, ['s1:2'])
  assert.match(anchor, /^Source 1 — /)
  assert.match(anchor, /Section 2/)
})

test('deriveSourceAnchor skips invalid refs and uses the first valid one', async () => {
  const compact = await buildSourceCompaction({ sourceTextFallback: makeSource(3, 200) })
  const anchor = deriveSourceAnchor(compact, ['s9:9', 's1:1'])
  assert.match(anchor, /^Source 1 — /)
})

test('deriveSourceAnchor never fabricates a fallback for unsupported evidence', async () => {
  const compact = await buildSourceCompaction({ sourceTextFallback: makeSource(3, 200) })
  assert.equal(deriveSourceAnchor(compact, ['s9:9']), '')
  assert.equal(deriveSourceAnchor(compact, []), '')
  assert.equal(deriveSourceAnchor(compact, null), '')
  assert.equal(deriveSourceAnchor(null, ['s1:1']), '')
})
