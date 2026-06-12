import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('lib/memory/service.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

const module = { exports: {} }
const sandboxRequire = (id) => {
  if (id === 'crypto') return awaitableCrypto
  throw new Error(`Unexpected runtime import in Memory V2 contract check: ${id}`)
}
const awaitableCrypto = await import('node:crypto').then((value) => value.default ?? value)

vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`)(
  sandboxRequire,
  module,
  module.exports,
)

const {
  effectiveSkillMastery,
  formatLearnerMemoryContext,
  memoryEffectiveConfidence,
  normalizeMemoryValue,
} = module.exports

assert.equal(normalizeMemoryValue('  More   Examples '), 'more examples')
assert.equal(normalizeMemoryValue({ b: 2, a: 1 }), '{"a":1,"b":2}')

const start = new Date('2026-01-01T00:00:00.000Z')
const oneHalfLifeLater = new Date('2026-02-15T00:00:00.000Z')
assert.equal(memoryEffectiveConfidence({
  confidence: 0.8,
  authority: 'repeated_behavior',
  halfLifeDays: 45,
  validFrom: start,
  now: oneHalfLifeLater,
}), 0.4)
assert.equal(memoryEffectiveConfidence({
  confidence: 0.8,
  authority: 'explicit_user',
  halfLifeDays: 45,
  validFrom: start,
  now: oneHalfLifeLater,
}), 0.8)

const decayedMastery = effectiveSkillMastery({
  posteriorMastery: 0.9,
  stabilityDays: 30,
  lastAssessedAt: start,
  now: new Date('2026-01-31T00:00:00.000Z'),
})
assert(decayedMastery > 0.64 && decayedMastery < 0.66)

const context = formatLearnerMemoryContext({
  memories: [{
    kind: 'preference',
    key: 'teaching.knowledge_level',
    value: 'beginner',
    effective_confidence: 1,
  }],
  skills: [{
    label: 'Gradient descent',
    evidence_count: 3,
    state: 'developing',
  }],
  misconceptions: [{
    description: 'Confuses learning rate with gradient magnitude.',
  }],
})
assert.match(context, /personalization only, never factual evidence/)
assert.match(context, /Gradient descent/)
assert.match(context, /Confuses learning rate/)

console.log('Memory V2 contract verification passed.')
