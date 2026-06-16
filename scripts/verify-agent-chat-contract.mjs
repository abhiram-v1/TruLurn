import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('lib/doubts/context.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

const module = { exports: {} }
const sandboxRequire = (id) => {
  if (id === '@/lib/grounding/sourceGrounding') {
    return {
      buildSourceEvidencePackets: (items) => items,
      formatSourceEvidencePackets: (items) => items.map((item) => item.content).join('\n'),
    }
  }
  throw new Error(`Unexpected runtime import in agent chat contract check: ${id}`)
}

vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`)(
  sandboxRequire,
  module,
  module.exports,
)

const { DOUBT_SYSTEM_PROMPT, buildDoubtPrompt } = module.exports

assert.match(DOUBT_SYSTEM_PROMPT, /There is no fixed sentence, paragraph, word, or token target/)
assert.match(DOUBT_SYSTEM_PROMPT, /primary intelligence in this interaction/)
assert.match(DOUBT_SYSTEM_PROMPT, /Synthesize the available course context/)
assert.match(DOUBT_SYSTEM_PROMPT, /Prioritize correctness, clarity, reasoning, and completeness/)
assert.doesNotMatch(DOUBT_SYSTEM_PROMPT, /SHORT \(2[–-]5 sentences\)/)
assert.doesNotMatch(DOUBT_SYSTEM_PROMPT, /MEDIUM \(1[–-]3 focused paragraphs/)
assert.doesNotMatch(DOUBT_SYSTEM_PROMPT, /LONG \(multiple sections/)
assert.doesNotMatch(DOUBT_SYSTEM_PROMPT, /minimum complete answer/)
assert.doesNotMatch(DOUBT_SYSTEM_PROMPT, /answer briefly \(one paragraph\)/)

const base = {
  question: 'Why does this mechanism work, and when would it fail?',
  currentPage: {
    courseTitle: 'Systems',
    branchTitle: 'Foundations',
    branchPosition: 1,
    branchTotal: 2,
    topicTitle: 'Feedback',
    topicPosition: 1,
    topicTotal: 3,
    pageNumber: 1,
    totalPages: 2,
    globalPageNumber: 1,
    globalPageTotal: 6,
    content: 'Feedback changes future behavior using observed error.',
  },
  recentHistory: [],
  conceptMap: [],
  relevantPages: [],
  relevantDoubts: [],
  relevantSources: [],
}

const currentPagePrompt = buildDoubtPrompt({ ...base, type: 'current_page' })
assert.match(currentPagePrompt.user, /Synthesize the answer directly in your own voice/)
assert.match(currentPagePrompt.user, /Do not describe what the page says/)
assert.doesNotMatch(currentPagePrompt.user, /The answer is in the page content above/)

const coursePrompt = buildDoubtPrompt({ ...base, type: 'course_specific' })
assert.match(coursePrompt.system, /Synthesize a direct answer rather than reporting/)
assert.match(coursePrompt.user, /direct, reasoned, complete answer/)

for (const clientPath of ['lib/ai/openai/client.ts', 'lib/ai/gemini/client.ts']) {
  const client = fs.readFileSync(clientPath, 'utf8')
  assert.doesNotMatch(
    client,
    /\b(max_output_tokens|maxOutputTokens|max_completion_tokens|max_tokens)\b/,
    `${clientPath} should not impose an artificial response-length cap`,
  )
}

console.log('Agent chat depth and synthesis contract verification passed.')
