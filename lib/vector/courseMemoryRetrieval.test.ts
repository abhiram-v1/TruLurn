import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findRequiredPageAnchors,
  mergeCourseMemoryPages,
  type RelevantPage,
} from './retrieval.ts'

function page(overrides: Partial<RelevantPage>): RelevantPage {
  return {
    id: 'page',
    topic_id: 'topic',
    topic_title: 'Topic',
    page_number: 1,
    focus: null,
    summary: null,
    content: 'content',
    score: null,
    ...overrides,
  }
}

function collection(rows: any[]) {
  return {
    find() {
      return {
        project() {
          return {
            async toArray() {
              return rows
            },
          }
        },
      }
    },
  }
}

test('required prerequisite pages are retrieved without depending on embeddings', async () => {
  const pages = [
    {
      _id: 'gd-intro',
      topic_id: 'gradient-descent',
      page_number: 1,
      focus: 'Optimization intuition',
      summary: 'Move parameters downhill.',
      content: 'Gradient descent updates weights in the direction that reduces loss.',
      // Deliberately no embedding fields: dependency retrieval must still work.
    },
    {
      _id: 'gd-gradients',
      topic_id: 'gradient-descent',
      page_number: 2,
      focus: 'Using loss gradients',
      summary: 'The gradient supplies an update direction for every weight.',
      content: 'Given a loss gradient, gradient descent updates each weight using the learning rate.',
    },
  ]
  const topics = [{ _id: 'gradient-descent', title: 'Gradient Descent' }]
  const db = {
    collection(name: string) {
      if (name === 'pages') return collection(pages)
      if (name === 'topics') return collection(topics)
      throw new Error(`Unexpected collection ${name}`)
    },
  }

  const result = await findRequiredPageAnchors({
    db: db as any,
    query: 'How does backpropagation provide loss gradients to gradient descent?',
    courseId: 'course',
    userId: 'learner',
    requiredTopicIds: ['gradient-descent'],
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'gd-gradients')
  assert.deepEqual(result[0].retrieval_methods, ['dependency'])
})

test('required anchors survive semantic deduplication and are ordered first', () => {
  const required = page({ id: 'required', topic_id: 'gradient-descent' })
  const semanticDuplicate = page({
    id: 'required',
    topic_id: 'gradient-descent',
    retrieval_methods: ['dense', 'lexical'],
  })
  const semanticOther = page({ id: 'other', topic_id: 'derivatives' })

  const result = mergeCourseMemoryPages({
    required: [required],
    relevant: [semanticDuplicate, semanticOther],
    limit: 2,
  })

  assert.deepEqual(result.map((item) => item.id), ['required', 'other'])
})
