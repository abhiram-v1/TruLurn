import assert from 'node:assert/strict'
import test from 'node:test'
import { levelToMasteryPercent, masteryPercentToLevel } from './mastery.ts'

test('levelToMasteryPercent converts the 1-5 scale to a 0-100 percentage', () => {
  assert.equal(levelToMasteryPercent(0), 0)
  assert.equal(levelToMasteryPercent(null), 0)
  assert.equal(levelToMasteryPercent(undefined), 0)
  assert.equal(levelToMasteryPercent(1), 20)
  assert.equal(levelToMasteryPercent(3), 60)
  assert.equal(levelToMasteryPercent(5), 100)
})

test('masteryPercentToLevel converts back to the 1-5 scale', () => {
  assert.equal(masteryPercentToLevel(0), 0)
  assert.equal(masteryPercentToLevel(null), 0)
  assert.equal(masteryPercentToLevel(20), 1)
  assert.equal(masteryPercentToLevel(60), 3)
  assert.equal(masteryPercentToLevel(100), 5)
})

test('the two directions round-trip for every exact step on the 1-5 scale', () => {
  for (let level = 1; level <= 5; level += 1) {
    assert.equal(masteryPercentToLevel(levelToMasteryPercent(level)), level)
  }
})
