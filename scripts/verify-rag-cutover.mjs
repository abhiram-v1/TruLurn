import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadTypeScriptModule(path, mocks = {}) {
  const source = fs.readFileSync(path, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  const sandboxRequire = (id) => {
    if (id in mocks) return mocks[id]
    throw new Error(`Unexpected runtime import in RAG cutover contract check: ${id}`)
  }
  vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`)(
    sandboxRequire,
    module,
    module.exports,
  )
  return module.exports
}

const crypto = await import('node:crypto').then((value) => value.default ?? value)
const cutover = loadTypeScriptModule('lib/vector/cutover.ts', { crypto })
const ranking = loadTypeScriptModule('lib/vector/ranking.ts')

const cohortInput = {
  seed: 'stable-release',
  userId: 'user-1',
  courseId: 'course-1',
  workflow: 'lesson_generation',
}
assert.equal(cutover.cohortBucket(cohortInput), cutover.cohortBucket(cohortInput))

const legacy = cutover.resolveCutoverSelection({
  ...cohortInput,
  policy: { mode: 'legacy', rolloutPercent: 100 },
})
assert.equal(legacy.selectionVersion, 'dense-v1')
assert.equal(legacy.collectShadow, false)

const shadow = cutover.resolveCutoverSelection({
  ...cohortInput,
  policy: { mode: 'shadow', rolloutPercent: 100 },
})
assert.equal(shadow.selectionVersion, 'dense-v1')
assert.equal(shadow.collectShadow, true)

const noCanary = cutover.resolveCutoverSelection({
  ...cohortInput,
  policy: { mode: 'canary', rolloutPercent: 0 },
})
const fullCanary = cutover.resolveCutoverSelection({
  ...cohortInput,
  policy: { mode: 'canary', rolloutPercent: 100 },
})
assert.equal(noCanary.selectionVersion, 'dense-v1')
assert.equal(fullCanary.selectionVersion, 'hybrid-v2')
assert.equal(fullCanary.canarySelected, true)

const v2 = cutover.resolveCutoverSelection({
  ...cohortInput,
  policy: { mode: 'v2', rolloutPercent: 0 },
})
assert.equal(v2.selectionVersion, 'hybrid-v2')
assert.equal(cutover.clampPercent(-10), 0)
assert.equal(cutover.clampPercent(140), 100)

const dense = ranking.denseRank({
  dense: [
    { id: 'a', item: 'A', text: 'alpha', groupKey: 'one', score: 0.9 },
    { id: 'b', item: 'B', text: 'beta', groupKey: 'one', score: 0.8 },
    { id: 'c', item: 'C', text: 'gamma', groupKey: 'two', score: 0.7 },
    { id: 'd', item: 'D', text: 'delta', groupKey: 'three', score: 0.1 },
  ],
  limit: 3,
  minimumScore: 0.2,
  maxPerGroup: 1,
})
assert.deepEqual(dense.map((candidate) => candidate.id), ['a', 'c'])

console.log('RAG Phase 5 cutover contract verification passed.')
