'use client'

// Design-QA preview for the Traccia rail — renders MiniRoadmap with mock
// course data so the rail can be inspected without signing in or generating
// a course. Not linked from anywhere; safe to delete.

import { useState } from 'react'
import { MiniRoadmap } from '@/components/learn/MiniRoadmap'
import type { Topic, TopicState } from '@/types'

let seq = 0
function makeTopic(overrides: Partial<Topic> & { id: string; title: string; section: string }): Topic {
  seq += 1
  return {
    course_id: 'preview',
    parent_id: null,
    position: seq,
    state: 'locked' as TopicState,
    understanding_level: null,
    prerequisites: [],
    created_at: new Date().toISOString(),
    branch_id: 'preview-branch',
    sequence_index: seq,
    ...overrides,
  }
}

function container(id: string, title: string, section: string, state: TopicState, childCount: number): Topic {
  return makeTopic({
    id,
    title,
    section,
    state,
    node_type: 'container',
    children_count: childCount,
    is_leaf: false,
    path_ids: [id],
  })
}

function leaf(id: string, title: string, section: string, state: TopicState, parentId: string): Topic {
  return makeTopic({
    id,
    title,
    section,
    state,
    parent_id: parentId,
    node_type: 'learning_unit',
    is_leaf: true,
    children_count: 0,
    path_ids: [parentId, id],
  })
}

const S1 = 'Getting oriented'
const S2 = 'Mathematical objects before arrays'
const S3 = 'Core operations and their mathematical reasons'
const S4 = 'Spaces, spans, and independence'

const TOPICS: Topic[] = [
  container('orient-1', 'Why linear algebra for ML', S1, 'mastered', 3),
  leaf('t-build', 'What you will be able to build', S1, 'mastered', 'orient-1'),
  leaf('t-read', 'How to read the notation in this course', S1, 'mastered', 'orient-1'),
  leaf('t-tools', 'Setting up NumPy and your notebook', S1, 'mastered', 'orient-1'),

  container('objects-1', 'What the objects are', S2, 'active', 6),
  leaf('t-scalars', 'Scalars', S2, 'mastered', 'objects-1'),
  leaf('t-vectors', 'Vectors', S2, 'active', 'objects-1'),
  leaf('t-rowcol', 'Row vectors vs column vectors', S2, 'active', 'objects-1'),
  leaf('t-matrices', 'Matrices', S2, 'locked', 'objects-1'),
  leaf('t-shape', 'Dimensions and shape', S2, 'locked', 'objects-1'),
  leaf('t-notation', 'Matrix notation and indexing', S2, 'locked', 'objects-1'),
  container('objects-2', 'Visual intuition for vectors', S2, 'locked', 2),
  leaf('t-arrows', 'Vectors as geometric arrows', S2, 'locked', 'objects-2'),
  leaf('t-space', 'Coordinates and the plane', S2, 'locked', 'objects-2'),

  container('ops-1', 'Basic vector operations', S3, 'locked', 4),
  leaf('t-vadd', 'Addition and subtraction', S3, 'locked', 'ops-1'),
  leaf('t-scal', 'Scalar multiplication', S3, 'locked', 'ops-1'),
  leaf('t-lincomb', 'Linear combinations', S3, 'locked', 'ops-1'),
  leaf('t-dot', 'The dot product', S3, 'locked', 'ops-1'),
  container('ops-2', 'Basic matrix operations', S3, 'locked', 4),
  leaf('t-madd', 'Matrix addition', S3, 'locked', 'ops-2'),
  leaf('t-matmul', 'Matrix multiplication', S3, 'locked', 'ops-2'),
  leaf('t-transpose', 'The transpose', S3, 'locked', 'ops-2'),
  leaf('t-inverse', 'Identity and inverse', S3, 'locked', 'ops-2'),

  container('spaces-1', 'Vector spaces', S4, 'locked', 3),
  leaf('t-span', 'Span', S4, 'locked', 'spaces-1'),
  leaf('t-indep', 'Linear independence', S4, 'locked', 'spaces-1'),
  leaf('t-basis', 'Basis', S4, 'locked', 'spaces-1'),
]

const CONCEPT_PAGES = [
  { id: 'pg-1', page_number: 1, concepts: ['Intuition: a vector as an arrow'], summary: null },
  { id: 'pg-2', page_number: 2, concepts: ['The formal definition'], summary: null },
  { id: 'pg-3', page_number: 3, concepts: ['Vectors in code with NumPy'], summary: null },
  { id: 'pg-4', page_number: 4, concepts: ['Common pitfalls & checks'], summary: null },
]

export default function TracciaPreviewPage() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="study-shell">
      <main className={`learn-shell ${collapsed ? 'roadmap-collapsed' : ''}`}>
        <aside className="roadmap-panel">
          <MiniRoadmap
            topics={TOPICS}
            currentTopicId="t-vectors"
            courseId="preview"
            courseTitle="Linear Algebra for Machine Learning"
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
            currentPageNumber={2}
            totalPlannedPages={4}
            conceptPages={CONCEPT_PAGES}
          />
        </aside>
        <section className="lesson-panel" style={{ display: 'grid', placeItems: 'center' }}>
          <p style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>
            Traccia rail preview — lesson panel intentionally empty.
          </p>
        </section>
        <aside className="chat-panel" />
      </main>
    </div>
  )
}
