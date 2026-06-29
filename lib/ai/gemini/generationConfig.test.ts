import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGeminiGenerationConfig } from './generationConfig.ts'

test('Gemini structured output sends JSON schema in generationConfig', () => {
  const schema = {
    name: 'graph',
    schema: {
      type: 'object',
      required: ['topics'],
      properties: { topics: { type: 'array' } },
    },
  }
  const config = buildGeminiGenerationConfig({
    model: 'gemini-3.5-flash',
    responseMimeType: 'text/plain',
    responseSchema: schema,
  })

  assert.equal(config.responseMimeType, 'application/json')
  assert.deepEqual(config.responseJsonSchema, schema.schema)
})

test('Gemini generation keeps ordinary MIME behavior without a schema', () => {
  const config = buildGeminiGenerationConfig({
    model: 'gemini-3.5-flash',
    responseMimeType: 'text/plain',
  })
  assert.equal(config.responseMimeType, 'text/plain')
  assert.equal('responseJsonSchema' in config, false)
  assert.equal('thinkingConfig' in config, false)
})

test('Gemini 3 models map reasoning effort to thinkingLevel', () => {
  const config = buildGeminiGenerationConfig({
    model: 'gemini-3.5-flash',
    reasoningEffort: 'medium',
    responseMimeType: 'text/plain',
  })

  assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'medium' })
})

test('Gemini 3 models clamp extra-high reasoning to high thinkingLevel', () => {
  const config = buildGeminiGenerationConfig({
    model: 'gemini-3.1-flash-lite',
    reasoningEffort: 'xhigh',
    responseMimeType: 'text/plain',
  })

  assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'high' })
})

test('Gemini 2.5 models use dynamic thinking for substantive reasoning', () => {
  const config = buildGeminiGenerationConfig({
    model: 'gemini-2.5-flash',
    reasoningEffort: 'high',
    responseMimeType: 'text/plain',
  })

  assert.deepEqual(config.thinkingConfig, { thinkingBudget: -1 })
})

test('Gemini 2.5 models can disable thinking for minimal reasoning', () => {
  const config = buildGeminiGenerationConfig({
    model: 'gemini-2.5-flash-lite',
    reasoningEffort: 'minimal',
    responseMimeType: 'text/plain',
  })

  assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 })
})
