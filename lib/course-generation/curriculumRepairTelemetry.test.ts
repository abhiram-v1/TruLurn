import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateCurriculumCost } from './curriculumCost.ts'

test('curriculum cost estimation separates cached input and output rates', () => {
  const previous = {
    input: process.env.CURRICULUM_INPUT_USD_PER_MILLION,
    cached: process.env.CURRICULUM_CACHED_INPUT_USD_PER_MILLION,
    output: process.env.CURRICULUM_OUTPUT_USD_PER_MILLION,
  }
  process.env.CURRICULUM_INPUT_USD_PER_MILLION = '1'
  process.env.CURRICULUM_CACHED_INPUT_USD_PER_MILLION = '0.1'
  process.env.CURRICULUM_OUTPUT_USD_PER_MILLION = '2'
  try {
    assert.equal(estimateCurriculumCost({
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 500,
    }), 0.00164)
  } finally {
    if (previous.input == null) delete process.env.CURRICULUM_INPUT_USD_PER_MILLION
    else process.env.CURRICULUM_INPUT_USD_PER_MILLION = previous.input
    if (previous.cached == null) delete process.env.CURRICULUM_CACHED_INPUT_USD_PER_MILLION
    else process.env.CURRICULUM_CACHED_INPUT_USD_PER_MILLION = previous.cached
    if (previous.output == null) delete process.env.CURRICULUM_OUTPUT_USD_PER_MILLION
    else process.env.CURRICULUM_OUTPUT_USD_PER_MILLION = previous.output
  }
})

test('curriculum cost estimation stays null until pricing is configured', () => {
  const previousInput = process.env.CURRICULUM_INPUT_USD_PER_MILLION
  const previousOutput = process.env.CURRICULUM_OUTPUT_USD_PER_MILLION
  delete process.env.CURRICULUM_INPUT_USD_PER_MILLION
  delete process.env.CURRICULUM_OUTPUT_USD_PER_MILLION
  try {
    assert.equal(estimateCurriculumCost({ inputTokens: 100 }), null)
  } finally {
    if (previousInput != null) process.env.CURRICULUM_INPUT_USD_PER_MILLION = previousInput
    if (previousOutput != null) process.env.CURRICULUM_OUTPUT_USD_PER_MILLION = previousOutput
  }
})
