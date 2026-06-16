import assert from 'node:assert/strict'
import test from 'node:test'
import type { Db } from 'mongodb'
import {
  resolveCourseSkillKeys,
  retrieveCourseSkillContext,
} from './context.ts'

function fakeDb(packs: any[]) {
  return {
    collection(name: string) {
      assert.equal(name, 'courseSkillPacks')
      return {
        find() {
          return {
            async toArray() {
              return packs
            },
          }
        },
      }
    },
  } as unknown as Db
}

test('normalizes canonical and transitional course skill references', () => {
  assert.deepEqual(resolveCourseSkillKeys({
    course_skill_keys: ['core', 'visuals'],
    skill_set_keys: ['visuals', 'assessment'],
    course_skill_key: 'core',
  }), ['core', 'visuals', 'assessment'])
})

test('returns no context when a course has no attached skill packs', async () => {
  const result = await retrieveCourseSkillContext({
    db: fakeDb([]),
    course: {},
    query: 'anything',
    surface: 'lesson',
  })
  assert.equal(result, null)
})

test('retrieves shared and surface instructions plus only relevant documents', async () => {
  const result = await retrieveCourseSkillContext({
    db: fakeDb([{
      key: 'subject-pack',
      version: 3,
      title: 'Subject Pack',
      instructions: {
        shared: 'Use the canonical terminology.',
        lesson: 'Teach the mechanism before edge cases.',
        agent: 'Answer questions directly.',
      },
      documents: [
        {
          title: 'Growth visual conventions',
          tags: ['growth', 'visual'],
          content: 'Use the subject-defined growth representation and label assumptions.',
        },
        {
          title: 'Unrelated storage notes',
          tags: ['storage'],
          content: 'Defines persistence and archival conventions.',
        },
      ],
    }]),
    course: { course_skill_keys: ['subject-pack'] },
    query: 'show the growth visual',
    surface: 'lesson',
  })

  assert.ok(result)
  assert.deepEqual(result.packKeys, ['subject-pack'])
  assert.match(result.text, /canonical terminology/i)
  assert.match(result.text, /mechanism before edge cases/i)
  assert.match(result.text, /Growth visual conventions/)
  assert.doesNotMatch(result.text, /Unrelated storage notes/)
  assert.equal(result.key.length, 16)
})
