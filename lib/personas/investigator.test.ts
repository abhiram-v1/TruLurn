import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInvestigatorDirective,
  selectInvestigatorPageType,
} from './investigator.ts'

test('selects Investigator paths without forcing a mystery', () => {
  assert.equal(selectInvestigatorPageType({
    contentKind: 'full_page',
    sequenceRole: 'introduce',
    pageNumber: 1,
  }), 'major_mystery')
  assert.equal(selectInvestigatorPageType({
    focus: 'Diagnose why test accuracy collapses from overfitting',
    contentKind: 'full_page',
  }), 'failure_analysis')
  assert.equal(selectInvestigatorPageType({
    focus: 'Derive the probability equation',
    contentKind: 'full_page',
  }), 'mathematical_mechanism')
  assert.equal(selectInvestigatorPageType({
    contentKind: 'section',
    targetLength: 'short',
  }), 'support')
})

test('major Investigator pages preserve technical depth', () => {
  const directive = buildInvestigatorDirective({
    surface: 'lesson',
    lesson: {
      contentKind: 'full_page',
      sequenceRole: 'introduce',
      pageNumber: 1,
      topicDepth: 'critical',
    },
  })
  assert.match(directive, /tempting wrong explanation/i)
  assert.match(directive, /formal definition/i)
  assert.match(directive, /worked example/i)
  assert.match(directive, /Exam and interview ready/i)
  assert.match(directive, /verdict/i)
  assert.ok(directive.length < 4200)
})

test('Investigator behavior extends across chat, quiz, and recall', () => {
  assert.match(buildInvestigatorDirective({ surface: 'agent' }), /symptom, evidence, hypothesis, and conclusion/i)
  assert.match(buildInvestigatorDirective({ surface: 'quiz' }), /plausible competing explanations/i)
  assert.match(buildInvestigatorDirective({ surface: 'recall' }), /decisive clue/i)
})
