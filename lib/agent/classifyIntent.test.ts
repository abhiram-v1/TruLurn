import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIntent, classifyIntentDeterministically } from './classifyIntent.ts'

// The deterministic classifier is the agent's routing brain: it decides, with no
// AI call, whether a lesson-chat message is a command (action) or a question
// (doubt). These tests pin that routing so a regex tweak can't silently reroute
// "next" into a doubt, or a plain question into a destructive page regen.

function action(message: string) {
  const result = classifyIntentDeterministically(message)
  assert.ok(result && result.kind === 'action', `expected an action for "${message}", got ${JSON.stringify(result)}`)
  return result.intent
}

function doubt(message: string) {
  const result = classifyIntentDeterministically(message)
  assert.ok(result && result.kind === 'doubt', `expected a doubt for "${message}", got ${JSON.stringify(result)}`)
  return result.questionType
}

test('bare navigation and regen commands map to their action intents', () => {
  assert.equal(action('next'), 'next_topic')
  assert.equal(action('next topic'), 'next_topic')
  assert.equal(action('move on'), 'next_topic')
  assert.equal(action('go back'), 'prev_topic')
  assert.equal(action('previous topic'), 'prev_topic')
  assert.equal(action('quiz me'), 'quiz_request')
  assert.equal(action('start quiz'), 'quiz_request')
  assert.equal(action('explain again'), 'explain_again')
  assert.equal(action('go deeper'), 'go_deeper')
  assert.equal(action('simplify'), 'simplify')
  assert.equal(action('show example'), 'show_example')
})

test('command detection tolerates polite wrappers but not extra content', () => {
  assert.equal(action('can you simplify'), 'simplify')
  assert.equal(action('please go deeper'), 'go_deeper')
  // "go deeper on recursion" is a question about a concept, not a bare regen
  // command — it must NOT trigger a destructive page regeneration.
  const onRecursion = classifyIntentDeterministically('can you go deeper on recursion?')
  assert.ok(!onRecursion || onRecursion.kind !== 'action' || onRecursion.intent !== 'go_deeper')
})

test('skip intent requires an explicit understood + move-on signal', () => {
  assert.equal(action('I already understand this, move on'), 'skip_current')
  assert.equal(action('skip the rest of this topic'), 'skip_current')
  assert.equal(action('I know the basics, continue'), 'skip_current')
  // A bare confidence statement is not a skip command — it stays a question.
  const vague = classifyIntentDeterministically('I think I get this')
  assert.ok(!vague || vague.kind !== 'action')
})

test('generate-page and navigate/custom-quiz phrasings route correctly', () => {
  assert.equal(action('generate a new page with examples'), 'generate_page')
  assert.equal(action('make another custom lesson'), 'generate_page')
  assert.equal(action('go to the recursion topic'), 'go_to_topic')
  assert.equal(action('quiz me on recursion'), 'custom_quiz')
})

test('questions route to the right doubt retrieval strategy', () => {
  assert.equal(doubt('what did we cover earlier about closures'), 'course_specific')
  assert.equal(doubt('how does this connect to what we covered before'), 'course_specific')
  assert.equal(doubt('what does this example mean'), 'current_page')
  // Product/app questions are answered from app knowledge, scoped as current_page.
  assert.equal(doubt('what is trulurn'), 'current_page')
})

test('genuinely ambiguous free-form messages defer to the AI classifier', () => {
  assert.equal(classifyIntentDeterministically('tell me a joke'), null)
  assert.equal(classifyIntentDeterministically(''), null)
})

test('classifyIntent short-circuits deterministic commands without an AI call', async () => {
  // A deterministic input must resolve from the fast path; if it reached the AI
  // call this would attempt a network request and fail in the test environment.
  const result = await classifyIntent('next', '', undefined)
  assert.deepEqual(result, { kind: 'action', intent: 'next_topic' })
})
