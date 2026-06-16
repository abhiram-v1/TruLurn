import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateLessonQuality } from '../../topic-pages/lessonQuality.ts'
import type { GeneratedTopicPage } from '../../topic-pages/generateTopicPage.ts'

const BASE_CONTENT = `Machine learning earns its place in four situations, because each one represents a case where the alternative — hand-written rules — breaks down under the weight of complexity.

First, when writing the rules yourself becomes a burden. A spam filter is the textbook case: you could write rules, but spammers adapt, rules grow, exceptions accumulate, and you are maintaining a bureaucracy instead of a filter. Machine learning sidesteps this because the algorithm learns the rules from the data itself.

Second, when the pattern changes over time. Fixed rules cannot update themselves. A fraud-detection system trained on yesterday's patterns therefore needs to retrain as attackers shift tactics — which is exactly what a learning system can do automatically, without human intervention.

Third, when no known algorithm exists. Speech recognition is a case where the pattern connecting sound waves to words is too complex to specify manually. The only way to build it is to let the model discover the mapping from millions of examples.

Fourth, when the goal is discovery rather than prediction. You want to find patterns in the data that you do not know in advance — for instance, segmenting customers into distinct groups you never defined beforehand. The model reveals structure that no pre-existing rule could have uncovered.

> **Mental model:** Use hand-written rules when the rules are already clear to you; use machine learning when the source of the patterns must come from the data itself.

Machine learning does not replace thinking. It replaces the part of thinking that would otherwise turn into an ever-growing, unmaintainable checklist of edge cases and exceptions.

The four situations share a common thread: they all involve learning from experience because the answers are encoded in existing examples, waiting to be extracted. What distinguishes machine learning from conventional programming is that it prioritises predictive accuracy over hand-crafted logic, which is why it thrives precisely where human intuition and explicit rule-writing break down.`

// Fully qualified page baseline used as the starting point for all regression fixtures.
function basePage(overrides: Partial<GeneratedTopicPage> = {}): GeneratedTopicPage {
  return {
    page_number: 1,
    focus: 'When to use machine learning',
    core_realization: 'Machine learning is the right tool when the rules cannot be written by hand — because they are too many, too fluid, too complex, or unknown.',
    content: BASE_CONTENT,
    summary: 'When machine learning is the right tool: four situations where learning beats rule-writing.',
    key_concepts: ['machine learning', 'automation', 'adaptability'],
    topic_depth: 'medium',
    concept_kind: 'mechanism',
    content_kind: 'full_page',
    should_generate_page: true,
    decision_reason: 'Full standalone lesson.',
    estimated_length: 'medium',
    requires_quiz: false,
    covered_concepts: ['machine learning', 'automation'],
    reused_concepts: [],
    reminder_concepts: [],
    example_refs: [],
    sections: [{ type: 'core', content: BASE_CONTENT }],
    ...overrides,
  }
}

const baseTopic = { title: 'When to Use Machine Learning', description: 'Overview of when ML is appropriate' }

describe('Lesson quality regressions — known production failures', () => {
  // ── Source narration ────────────────────────────────────────────────────────

  it('rejects a page whose opening narrates the source instead of teaching', () => {
    const page = basePage({
      content: 'The source says machine learning is useful when manual rule-writing becomes burdensome.\n\nThe source identifies spam filters as an example of a task where machine learning reduces manual rule-writing.\n\nThe source also notes that evolving spam tactics are one reason learning helps.',
      sections: [{ type: 'core', content: 'The source says machine learning is useful when manual rule-writing becomes burdensome.\n\nThe source identifies spam filters as an example of a task where machine learning reduces manual rule-writing.\n\nThe source also notes that evolving spam tactics are one reason learning helps.' }],
    })
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 1, sourceGrounded: true })
    assert.equal(report.accepted, false, 'Source-narrating opening must be rejected')
    const sourceIssue = report.issues.find((i) => i.code === 'OPENING_NARRATES_SOURCE')
    assert.ok(sourceIssue, `Expected OPENING_NARRATES_SOURCE issue but got: ${JSON.stringify(report.issues)}`)
    assert.equal(sourceIssue.severity, 'critical')
  })

  it('accepts a page that teaches source content directly without narration', () => {
    const page = basePage({
      source_citations: [{ source_id: 'source-1', chunk_id: 'chunk-1' }],
      grounding: { status: 'supported', checked_claims: 4, supported_claims: 4, unsupported_claims: [] },
    })
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 1, sourceGrounded: true })
    assert.equal(report.accepted, true, `Clean page rejected with score ${report.overall_score}: ${JSON.stringify(report.issues)}`)
  })

  // ── Throat-clearing openings ────────────────────────────────────────────────

  it('rejects a page that opens with "In this page, we will cover"', () => {
    const badOpening = 'In this page, we will cover when machine learning is the right tool.\n\nMachine learning is useful in four situations.'
    const page = basePage({
      content: badOpening,
      sections: [{ type: 'core', content: badOpening }],
    })
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 1 })
    assert.equal(report.accepted, false, 'Throat-clearing opening must be rejected')
    const issue = report.issues.find((i) => i.code === 'OPENING_THROAT_CLEARING')
    assert.ok(issue, `Expected OPENING_THROAT_CLEARING but got: ${JSON.stringify(report.issues)}`)
  })

  it('rejects a page that opens with a canned hypothetical hook', () => {
    const badOpening = 'Suppose you want to build a spam filter but you have thousands of emails. Machine learning solves this.'
    const page = basePage({
      content: badOpening + '\n\nMachine learning earns its place when rules become too hard to write.',
      sections: [{ type: 'core', content: badOpening + '\n\nMachine learning earns its place when rules become too hard to write.' }],
    })
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 1 })
    assert.equal(report.accepted, false, 'Canned hypothetical hook must be rejected')
    const issue = report.issues.find((i) => i.code === 'OPENING_CANNED_HOOK')
    assert.ok(issue, `Expected OPENING_CANNED_HOOK but got: ${JSON.stringify(report.issues)}`)
  })

  // ── Padding / paragraph repetition ─────────────────────────────────────────

  it('flags a page where two paragraphs restate the same idea with different wording', () => {
    const paddedContent = [
      'Machine learning is the appropriate tool when the underlying rules are too complex and numerous to write and maintain manually.',
      '',
      'When the underlying rules become too complex and numerous to write and maintain manually, machine learning is the appropriate tool.',
      '',
      'A third distinct topic: machine learning also enables discovery, allowing you to find hidden patterns that no human-defined rule could have captured in advance.',
    ].join('\n')
    const page = basePage({
      content: paddedContent,
      sections: [{ type: 'core', content: paddedContent }],
    })
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 1 })
    const issue = report.issues.find((i) => i.code === 'internal_repetition')
    assert.ok(issue, `Expected internal_repetition but got: ${JSON.stringify(report.issues)}`)
  })

  // ── Content continuity ─────────────────────────────────────────────────────

  it('flags a page 2+ that has no continuity signal when previous pages exist', () => {
    const page = basePage({ page_number: 2 })
    const previousPages = [{ content: 'What is machine learning?', key_concepts: ['machine learning'], focus: 'Introduction' }]
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 2, previousPages })
    const issue = report.issues.find((i) => i.code === 'continuity_missing')
    assert.ok(issue, `Expected continuity_missing on page 2+ with prior pages: ${JSON.stringify(report.issues)}`)
  })

  it('does not flag continuity on page 1', () => {
    const page = basePage({ page_number: 1 })
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 1, previousPages: [] })
    const issue = report.issues.find((i) => i.code === 'continuity_missing')
    assert.equal(issue, undefined, 'Page 1 should not require a continuity signal')
  })

  // ── Empty/blank page guard ─────────────────────────────────────────────────

  it('rejects a page with fewer than 70 words', () => {
    const thinContent = 'Machine learning is useful.'
    const page = basePage({
      content: thinContent,
      sections: [{ type: 'core', content: thinContent }],
    })
    const report = evaluateLessonQuality({ page, topic: baseTopic, pageNumber: 1 })
    assert.equal(report.accepted, false, 'Page with < 70 words must be rejected')
    const issue = report.issues.find((i) => i.code === 'too_shallow')
    assert.ok(issue, `Expected too_shallow but got: ${JSON.stringify(report.issues)}`)
  })
})
