'use client'

import { useMemo, useState } from 'react'
import { IconChevronUp, IconChevronDown, IconTrash } from '@tabler/icons-react'


// ── Curriculum preview & editor ────────────────────────────────────────────────
// Shown after the AI builds the curriculum but before atlas/page generation. The
// learner can rename, reorder, delete, and add branches/sections/topics, then
// approve. Editing the plan here is cheap; regenerating a whole course is not.

type AnyTopic = {
  id?: string
  title?: string
  description?: string
  children?: AnyTopic[]
  [k: string]: unknown
}
type AnySection = { title?: string; topics?: AnyTopic[]; [k: string]: unknown }
type AnyBranch = {
  id?: string
  title?: string
  description?: string
  sections?: AnySection[]
  topics?: AnyTopic[]
  [k: string]: unknown
}
type Curriculum = { title?: string; branches?: AnyBranch[]; [k: string]: unknown }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function slugify(text: string): string {
  return (
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) ||
    `node-${Math.random().toString(36).slice(2, 8)}`
  )
}

// Normalize so every branch has a `sections` array (wrap legacy topics-on-branch).
function normalize(curriculum: Curriculum): Curriculum {
  const next = clone(curriculum)
  next.branches = (next.branches ?? []).map((branch) => {
    if (!Array.isArray(branch.sections) || branch.sections.length === 0) {
      const topics = Array.isArray(branch.topics) ? branch.topics : []
      branch.sections = [{ title: '', topics }]
    }
    delete branch.topics
    branch.sections = branch.sections.map((section) => ({
      ...section,
      topics: Array.isArray(section.topics) ? section.topics : [],
    }))
    return branch
  })
  return next
}

function countTopics(curriculum: Curriculum): number {
  let n = 0
  for (const b of curriculum.branches ?? []) {
    for (const s of b.sections ?? []) {
      for (const t of s.topics ?? []) {
        n += 1 + (Array.isArray(t.children) ? t.children.length : 0)
      }
    }
  }
  return n
}

function move<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir
  if (target < 0 || target >= arr.length) return arr
  const copy = [...arr]
  ;[copy[index], copy[target]] = [copy[target], copy[index]]
  return copy
}

export function CurriculumPreview({
  jobId,
  curriculum: initialCurriculum,
  onApproved,
}: {
  jobId: string
  curriculum: Curriculum
  onApproved: () => void
}) {
  const [curr, setCurr] = useState<Curriculum>(() => normalize(initialCurriculum))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const topicCount = useMemo(() => countTopics(curr), [curr])
  const branchCount = curr.branches?.length ?? 0

  // ── Mutators (all immutable) ──────────────────────────────────────────────
  function mutate(fn: (draft: Curriculum) => void) {
    setCurr((prev) => {
      const draft = clone(prev)
      fn(draft)
      return draft
    })
  }

  const setCourseTitle = (v: string) => mutate((d) => { d.title = v })

  const setBranchField = (bi: number, field: 'title' | 'description', v: string) =>
    mutate((d) => { (d.branches![bi] as AnyBranch)[field] = v })

  const deleteBranch = (bi: number) =>
    mutate((d) => { d.branches!.splice(bi, 1) })

  const moveBranch = (bi: number, dir: -1 | 1) =>
    mutate((d) => { d.branches = move(d.branches!, bi, dir) })

  const addBranch = () =>
    mutate((d) => {
      d.branches!.push({
        id: slugify(`branch ${d.branches!.length + 1}`),
        title: 'New branch',
        description: '',
        state: 'not_started',
        sections: [{ title: '', topics: [] }],
      })
    })

  const setSectionTitle = (bi: number, si: number, v: string) =>
    mutate((d) => { d.branches![bi].sections![si].title = v })

  const setTopicField = (bi: number, si: number, ti: number, field: 'title' | 'description', v: string) =>
    mutate((d) => { (d.branches![bi].sections![si].topics![ti] as AnyTopic)[field] = v })

  const deleteTopic = (bi: number, si: number, ti: number) =>
    mutate((d) => { d.branches![bi].sections![si].topics!.splice(ti, 1) })

  const moveTopic = (bi: number, si: number, ti: number, dir: -1 | 1) =>
    mutate((d) => {
      const topics = d.branches![bi].sections![si].topics!
      d.branches![bi].sections![si].topics = move(topics, ti, dir)
    })

  const addTopic = (bi: number, si: number) =>
    mutate((d) => {
      d.branches![bi].sections![si].topics!.push({
        id: slugify(`topic ${Date.now()}`),
        title: 'New topic',
        description: '',
        prerequisites: [],
        depth: 'medium',
        estimated_pages: 3,
        node_type: 'learning_unit',
        children: [],
        initial_state: 'locked',
      })
    })

  async function approve() {
    if (submitting) return
    if (topicCount === 0) {
      setError('Add at least one topic before building the course.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/generation-jobs/${jobId}/curriculum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curriculum: curr }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save curriculum.')
      onApproved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save curriculum.')
      setSubmitting(false)
    }
  }

  return (
    <div className="curriculum-preview">
      <header className="curriculum-preview-head">
        <p className="eyebrow">Review your roadmap</p>
        <input
          className="curriculum-title-input"
          value={curr.title ?? ''}
          onChange={(e) => setCourseTitle(e.target.value)}
          placeholder="Course title"
          aria-label="Course title"
        />
        <p className="curriculum-preview-sub">
          Rename, reorder, remove, or add anything before we build the lessons.
        </p>
        <div className="curriculum-stat-pills">
          <span className="curriculum-stat-pill">{branchCount} {branchCount === 1 ? 'branch' : 'branches'}</span>
          <span className="curriculum-stat-pill">{topicCount} {topicCount === 1 ? 'topic' : 'topics'}</span>
        </div>
      </header>

      <div className="curriculum-branches">
        {(curr.branches ?? []).map((branch, bi) => (
          <div className="curriculum-branch" key={`branch-${bi}`}>
            <div className="curriculum-branch-head">
              <span className="curriculum-branch-index">{String(bi + 1).padStart(2, '0')}</span>
              <div className="curriculum-branch-fields">
                <input
                  className="curriculum-branch-title"
                  value={branch.title ?? ''}
                  onChange={(e) => setBranchField(bi, 'title', e.target.value)}
                  placeholder="Branch title"
                  aria-label="Branch title"
                />
                <input
                  className="curriculum-branch-desc"
                  value={branch.description ?? ''}
                  onChange={(e) => setBranchField(bi, 'description', e.target.value)}
                  placeholder="Short description (optional)"
                  aria-label="Branch description"
                />
              </div>
              <div className="curriculum-row-actions">
                <button
                  type="button"
                  onClick={() => moveBranch(bi, -1)}
                  disabled={bi === 0}
                  title="Move up"
                  aria-label="Move branch up"
                >
                  <IconChevronUp size={16} stroke={2} />
                </button>
                <button
                  type="button"
                  onClick={() => moveBranch(bi, 1)}
                  disabled={bi === branchCount - 1}
                  title="Move down"
                  aria-label="Move branch down"
                >
                  <IconChevronDown size={16} stroke={2} />
                </button>
                <button
                  type="button"
                  className="curriculum-delete"
                  onClick={() => deleteBranch(bi)}
                  title="Delete branch"
                  aria-label="Delete branch"
                >
                  <IconTrash size={16} stroke={1.8} />
                </button>
              </div>
            </div>

            <div className="curriculum-branch-body">
              {(branch.sections ?? []).map((section, si) => {
                const topics = section.topics ?? []
                return (
                  <div className="curriculum-section" key={`section-${bi}-${si}`}>
                    {(branch.sections?.length ?? 0) > 1 || (section.title ?? '').trim() ? (
                      <input
                        className="curriculum-section-title"
                        value={section.title ?? ''}
                        onChange={(e) => setSectionTitle(bi, si, e.target.value)}
                        placeholder="Section title (optional)"
                        aria-label="Section title"
                      />
                    ) : null}

                    <ul className="curriculum-topics">
                      {topics.map((topic, ti) => {
                        const childCount = Array.isArray(topic.children) ? topic.children.length : 0
                        return (
                          <li className="curriculum-topic" key={`topic-${bi}-${si}-${ti}`}>
                            <span className="curriculum-topic-num">{ti + 1}</span>
                            <div className="curriculum-topic-fields">
                              <input
                                className="curriculum-topic-title"
                                value={topic.title ?? ''}
                                onChange={(e) => setTopicField(bi, si, ti, 'title', e.target.value)}
                                placeholder="Topic title"
                                aria-label="Topic title"
                              />
                              {childCount > 0 ? (
                                <span className="curriculum-topic-children">{childCount} sub-topics</span>
                              ) : null}
                            </div>
                            <div className="curriculum-row-actions">
                              <button
                                type="button"
                                onClick={() => moveTopic(bi, si, ti, -1)}
                                disabled={ti === 0}
                                title="Move up"
                                aria-label="Move topic up"
                              >
                                <IconChevronUp size={14} stroke={2} />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveTopic(bi, si, ti, 1)}
                                disabled={ti === topics.length - 1}
                                title="Move down"
                                aria-label="Move topic down"
                              >
                                <IconChevronDown size={14} stroke={2} />
                              </button>
                              <button
                                type="button"
                                className="curriculum-delete"
                                onClick={() => deleteTopic(bi, si, ti)}
                                title="Delete topic"
                                aria-label="Delete topic"
                              >
                                <IconTrash size={14} stroke={1.8} />
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>

                    <button type="button" className="curriculum-add-topic" onClick={() => addTopic(bi, si)}>
                      + Add topic
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="curriculum-add-branch" onClick={addBranch}>
        + Add branch
      </button>

      {error ? <p className="curriculum-error">{error}</p> : null}

      <div className="curriculum-preview-actions">
        <button type="button" className="button" onClick={approve} disabled={submitting}>
          {submitting ? 'Building course…' : 'Looks good — build my course'}
        </button>
      </div>
    </div>
  )
}
