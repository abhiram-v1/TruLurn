import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSequenceContextPack } from './sequenceContext.ts'

function chain(items: any[]) {
  const api = {
    project() {
      return api
    },
    sort() {
      return api
    },
    limit() {
      return api
    },
    async toArray() {
      return items
    },
  }
  return api
}

function fakeDb(data: Record<string, any[]>) {
  return {
    collection(name: string) {
      return {
        find(query: any = {}) {
          const items = (data[name] ?? []).filter((item) => {
            if (query.course_id && item.course_id !== query.course_id) return false
            if (query.user_id && item.user_id !== query.user_id) return false
            if (query.topic_id?.$ne && String(item.topic_id) === String(query.topic_id.$ne)) return false
            if (query._id?.$in && !query._id.$in.map(String).includes(String(item._id))) return false
            return true
          })
          return chain(items)
        },
      }
    },
  } as any
}

test('sequence context ignores future generated summaries when marking concepts as already explained', async () => {
  const db = fakeDb({
    topics: [
      { _id: 'prior', course_id: 'course-1', title: 'Prior Topic', branch_id: 'b1', sequence_index: 1 },
      { _id: 'current', course_id: 'course-1', title: 'Regularization', branch_id: 'b1', sequence_index: 2 },
      { _id: 'future', course_id: 'course-1', title: 'Future Topic', branch_id: 'b1', sequence_index: 3 },
    ],
    pageSummaries: [
      {
        course_id: 'course-1',
        user_id: 'user-1',
        topic_id: 'future',
        page_number: 1,
        focus: 'Regularization',
        summary: 'Regularization was already explained here.',
        key_concepts: ['regularization'],
        covered_concepts: ['regularization'],
      },
    ],
    learningEvents: [],
  })

  const pack = await buildSequenceContextPack({
    db,
    courseId: 'course-1',
    userId: 'user-1',
    topic: {
      _id: 'current',
      title: 'Regularization',
      branch_id: 'b1',
      sequence_index: 2,
    },
    pageNumber: 1,
  })

  assert.match(pack.text, /Course sequence position: 2 of 3/)
  assert.match(pack.text, /future or out-of-order summaries ignored/)
  assert.doesNotMatch(pack.text, /Already explained: Regularization/)
  assert.match(pack.text, /Likely new concepts: Regularization/)
})
