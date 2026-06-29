import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersonaDirective } from './index.ts'

test('all stored persona values produce the same minimal lesson directive', () => {
  const immersive = buildPersonaDirective({
    persona: 'immersive_builder',
    surface: 'lesson',
  })
  const investigator = buildPersonaDirective({
    persona: 'investigator',
    surface: 'lesson',
  })

  assert.equal(immersive, investigator)
  assert.match(immersive, /formal definition, intuition, mechanism/i)
  assert.match(immersive, /one concrete example/i)
  assert.match(immersive, /one important limitation or misunderstanding/i)
  assert.match(immersive, /brief memory summary/i)
  assert.match(immersive, /Do not greet the learner/i)
  assert.match(immersive, /role-play a classroom/i)
  assert.doesNotMatch(immersive, /TEACHING PERSONA|PAGE PATH/i)
})
