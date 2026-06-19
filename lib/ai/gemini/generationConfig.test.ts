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
    responseMimeType: 'text/plain',
    responseSchema: schema,
  })

  assert.equal(config.responseMimeType, 'application/json')
  assert.deepEqual(config.responseJsonSchema, schema.schema)
})

test('Gemini generation keeps ordinary MIME behavior without a schema', () => {
  const config = buildGeminiGenerationConfig({
    responseMimeType: 'text/plain',
  })
  assert.equal(config.responseMimeType, 'text/plain')
  assert.equal('responseJsonSchema' in config, false)
})
