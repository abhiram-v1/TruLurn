import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { resolveAIFeatureTimeoutMs } from './timeouts.ts'

const ENV_KEY = 'AI_FEATURE_CURRICULUM_GENERATION_TIMEOUT_MS'
const originalValue = process.env[ENV_KEY]

afterEach(() => {
  if (originalValue === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = originalValue
})

test('curriculum generation gets a feature-specific four-minute timeout', () => {
  delete process.env[ENV_KEY]
  assert.equal(resolveAIFeatureTimeoutMs('curriculum_generation'), 240_000)
  assert.equal(resolveAIFeatureTimeoutMs('doubt_answer'), undefined)
})

test('feature timeout can be configured without changing the global AI timeout', () => {
  process.env[ENV_KEY] = '275000'
  assert.equal(resolveAIFeatureTimeoutMs('curriculum_generation'), 275_000)
})

test('an explicit call timeout takes precedence over the feature default', () => {
  process.env[ENV_KEY] = '275000'
  assert.equal(resolveAIFeatureTimeoutMs('curriculum_generation', 30_000), 30_000)
})

test('invalid feature timeout configuration fails clearly', () => {
  process.env[ENV_KEY] = 'later'
  assert.throws(
    () => resolveAIFeatureTimeoutMs('curriculum_generation'),
    /must be a positive number/,
  )
})

