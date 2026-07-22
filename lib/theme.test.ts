import assert from 'node:assert/strict'
import test from 'node:test'
import { isAccent, isTheme } from './theme.ts'

test('recognizes the supported local appearance preferences', () => {
  assert.equal(isTheme('light'), true)
  assert.equal(isTheme('dark'), true)
  assert.equal(isTheme('system'), false)
  assert.equal(isAccent('terracotta'), true)
  assert.equal(isAccent('indigo'), true)
  assert.equal(isAccent('teal'), true)
  assert.equal(isAccent('plum'), true)
  assert.equal(isAccent('amber'), false)
})
