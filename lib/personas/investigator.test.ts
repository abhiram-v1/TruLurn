import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInvestigatorDirective,
  selectInvestigatorPageType,
} from './investigator.ts'
import { buildPersonaDirective } from './index.ts'

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

test('Investigator selection no longer changes the lesson-writing prompt', () => {
  const directive = buildPersonaDirective({
    persona: 'investigator',
    surface: 'lesson',
    lesson: {
      contentKind: 'full_page',
      sequenceRole: 'introduce',
      pageNumber: 1,
      topicDepth: 'critical',
    },
  })
  assert.match(directive, /warm professor who is genuinely interested/i)
  assert.match(directive, /canonical terminology/i)
  assert.match(directive, /welcome to class/i)
  assert.doesNotMatch(directive, /Investigator|PAGE PATH|verdict/i)
  assert.ok(directive.length < 1000)
})

test('Investigator never labels content as exam- or interview-ready', () => {
  for (const lesson of [
    { contentKind: 'full_page', sequenceRole: 'introduce', pageNumber: 1, topicDepth: 'critical' },
    { focus: 'Diagnose why test accuracy collapses from overfitting', contentKind: 'full_page' },
    { focus: 'Derive the probability equation', contentKind: 'full_page' },
    { contentKind: 'section', targetLength: 'short' },
  ] as const) {
    const directive = buildInvestigatorDirective({ surface: 'lesson', lesson })
    assert.doesNotMatch(directive, /exam and interview ready/i)
    assert.doesNotMatch(directive, /exam[\s-]?ready|interview[\s-]?ready|exam\/interview/i)
  }
})

test('Investigator behavior extends across chat, quiz, and recall', () => {
  assert.match(buildInvestigatorDirective({ surface: 'agent' }), /observed facts, hypothesis, decisive evidence/i)
  assert.match(buildInvestigatorDirective({ surface: 'quiz' }), /plausible competing explanations/i)
  assert.match(buildInvestigatorDirective({ surface: 'recall' }), /decisive clue/i)
})
