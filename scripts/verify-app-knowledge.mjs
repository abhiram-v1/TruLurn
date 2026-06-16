import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('lib/agent/appKnowledge.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

const module = { exports: {} }
vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`)(
  (id) => {
    throw new Error(`Unexpected runtime import in app knowledge check: ${id}`)
  },
  module,
  module.exports,
)

const {
  APP_KNOWLEDGE,
  buildAppKnowledgeContext,
  retrieveAppKnowledge,
  shouldRetrieveAppKnowledge,
} = module.exports

assert(APP_KNOWLEDGE.length >= 15, 'The product corpus should cover the main app systems.')

assert.equal(shouldRetrieveAppKnowledge('What is this recall break stuff in the app?'), true)
assert.equal(shouldRetrieveAppKnowledge('How do recall breaks differ from spaced reviews?'), true)
assert.equal(shouldRetrieveAppKnowledge('What is Atlas versus Graph?'), true)
assert.equal(shouldRetrieveAppKnowledge('How does source-based learning work?'), true)
assert.equal(shouldRetrieveAppKnowledge('How does gradient descent work?'), false)
assert.equal(shouldRetrieveAppKnowledge('Explain computer memory hierarchy.'), false)
assert.equal(shouldRetrieveAppKnowledge('What is a graph in discrete mathematics?'), false)

assert.equal(
  retrieveAppKnowledge('What is this recall break stuff in the app?')[0]?.id,
  'recall-breaks',
)

const recallVsReview = retrieveAppKnowledge(
  'How do recall breaks differ from spaced reviews?',
  6,
).map((entry) => entry.id)
assert(recallVsReview.includes('recall-breaks'))
assert(recallVsReview.includes('spaced-reviews'))

const atlasVsGraph = retrieveAppKnowledge('What is Atlas versus Graph?', 6)
  .map((entry) => entry.id)
assert(atlasVsGraph.includes('atlas-traccia'))
assert(atlasVsGraph.includes('knowledge-graph'))

assert.equal(
  retrieveAppKnowledge('How does source-based learning work?')[0]?.id,
  'source-based-learning',
)
assert.equal(retrieveAppKnowledge('What can this app do?')[0]?.id, 'product-overview')

const collection = (name) => ({
  findOne: async () => {
    if (name === 'userSettings') {
      return { recall_break_mode: '30m', recall_break_duration_minutes: 15 }
    }
    if (name === 'studySessions') {
      return {
        active_ms: 25 * 60_000,
        active_ms_at_last_break: 10 * 60_000,
        pages: [{}, {}, {}],
        pages_at_last_break: 1,
        breaks_completed: 2,
        snoozed_until: null,
      }
    }
    return null
  },
  countDocuments: async () => 0,
})

const recallContext = await buildAppKnowledgeContext({
  db: { collection },
  userId: 'user-1',
  courseId: 'course-1',
  query: 'Explain this recall break feature in the app.',
})
assert.match(recallContext, /PRODUCT KNOWLEDGE CONTEXT:/)
assert.match(recallContext, /Current recall setting: 30m; protected break length: 15 minutes/)
assert.match(recallContext, /15 active minutes and 2 new pages since the last break/)
assert.match(recallContext, /does not by itself raise assessed mastery/)

const doubtHandler = fs.readFileSync('lib/doubts/handleDoubt.ts', 'utf8')
assert.match(
  doubtHandler,
  /!contextPlan\.needsAppKnowledge[\s\S]*type === 'course_specific'/,
  'App-only questions should not trigger unrelated course-vector retrieval.',
)
assert.match(
  doubtHandler,
  /requiresSourceGrounding[\s\S]*!contextPlan\.needsAppKnowledge/,
  'Product knowledge should remain separate from uploaded-source citation requirements.',
)

console.log('App knowledge retrieval contract verification passed.')
