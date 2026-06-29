import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAITeacherCurriculumPrompt,
  buildLegacyAITeacherCurriculumPrompt,
  buildLegacySourceCurriculumPrompt,
  buildSourceCurriculumPrompt,
  CURRICULUM_SYSTEM_PROMPT,
} from './curriculumPrompt.ts'
import type { CurriculumSkillInput } from './types.ts'

function baseInput(mode: CurriculumSkillInput['mode']): CurriculumSkillInput {
  return {
    topic: 'Database transactions',
    goals: 'Learn database transactions and recovery clearly.',
    mode,
    learningControl: 'balanced',
    courseDepth: 'standard',
    knowledgeLevel: 'intermediate',
    learningPurpose: 'practitioner',
  }
}

test('source prompt uses compact refs and omits the legacy JSON/rule monolith', () => {
  const user = buildSourceCurriculumPrompt(baseInput('source_grounded'), {
    sourceEvidence: '=== Source: Transactions ===\n## Section [s1:1]: Atomicity',
  })

  assert.match(user, /source_refs/)
  assert.match(user, /\[s1:1\]/)
  assert.doesNotMatch(user, /Return this exact JSON shape/)
  assert.doesNotMatch(user, /set source_anchor/i)
  assert.doesNotMatch(user, /set source_coverage/i)
  assert.ok(CURRICULUM_SYSTEM_PROMPT.length + user.length < 7000)
})

test('legacy compatibility prompts remain selectable as a rollback path', () => {
  const source = buildLegacySourceCurriculumPrompt(
    baseInput('source_grounded'),
    { sourceEvidence: '## Section [s1:1]: Atomicity' },
  )
  const teacher = buildLegacyAITeacherCurriculumPrompt(baseInput('ai_teacher'))
  assert.match(source, /Legacy compatibility rules/)
  assert.match(teacher, /Legacy compatibility rules/)
  assert.ok(source.length > buildSourceCurriculumPrompt(
    baseInput('source_grounded'),
    { sourceEvidence: '## Section [s1:1]: Atomicity' },
  ).length)
})

test('AI-teacher prompt is separate from source-grounding instructions', () => {
  const user = buildAITeacherCurriculumPrompt({
    ...baseInput('ai_teacher'),
    curriculumResearchBrief: 'Foundation: relational model\nDo not miss: transactions',
  })

  assert.match(user, /AI-teacher curriculum/)
  assert.match(user, /Research calibration/)
  assert.doesNotMatch(user, /source_refs/)
  assert.doesNotMatch(user, /complete syllabus boundary/)
  assert.ok(CURRICULUM_SYSTEM_PROMPT.length + user.length < 5000)
})
