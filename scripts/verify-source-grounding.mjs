import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('lib/grounding/sourceGrounding.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

const module = { exports: {} }
const sandboxRequire = (id) => {
  if (id === '@/lib/ai') {
    return {
      generateAI: async () => {
        throw new Error('AI calls are not part of the deterministic contract check.')
      },
      parseAIJson: JSON.parse,
    }
  }
  throw new Error(`Unexpected runtime import in grounding contract check: ${id}`)
}

vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`)(
  sandboxRequire,
  module,
  module.exports,
)

const {
  appendSourceLegend,
  buildSourceEvidencePackets,
  collectCitationIds,
  formatSourceEvidencePackets,
  publicSourceCitations,
} = module.exports

const packets = buildSourceEvidencePackets([
  {
    id: 'passage-a',
    topic_id: null,
    source_title: 'guide.pdf',
    source_document_id: 'doc-a',
    source_version_id: 'version-a',
    source_index: 0,
    passage_ordinal: 2,
    heading_path: ['Chapter 1', 'Definitions'],
    block_ordinals: [4, 5],
    char_start: 120,
    char_end: 360,
    content: 'A grounded definition.',
    score: 0.91,
    retrieval_methods: ['dense', 'lexical'],
  },
  {
    id: 'passage-b',
    topic_id: null,
    source_title: 'notes.md',
    content: 'A second source passage.',
    score: 0.73,
  },
])

assert.deepEqual(packets.map((packet) => packet.citation_id), ['S1', 'S2'])
assert.equal(packets[0].char_start, 120)
assert.equal(packets[0].heading_path.join(' > '), 'Chapter 1 > Definitions')

const formatted = formatSourceEvidencePackets(packets)
assert.match(formatted, /\[S1\] guide\.pdf/)
assert.match(formatted, /Evidence ID: passage-b/)

assert.deepEqual(
  collectCitationIds('One claim [S1]. Another [S2][S1].'),
  ['S1', 'S2'],
)

const citations = publicSourceCitations(packets, ['S1'])
assert.equal(citations.length, 1)
assert.equal(citations[0].evidence_id, 'passage-a')
assert.equal('content' in citations[0], false)

const legend = appendSourceLegend('Grounded answer [S1].', citations)
assert.match(legend, /\*\*Sources\*\*/)
assert.match(legend, /\[S1\] guide\.pdf, Chapter 1 > Definitions/)

console.log('Source grounding contract verification passed.')
