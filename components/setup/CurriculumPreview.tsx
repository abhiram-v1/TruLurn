'use client'

import { useMemo, useState } from 'react'
import { IconChevronUp, IconChevronDown, IconChevronRight, IconTrash, IconPlus } from '@tabler/icons-react'


// ── Curriculum preview & editor ────────────────────────────────────────────────
// Shown after the AI builds the curriculum but before atlas/page generation. The
// learner can rename, reorder, delete, and add branches/sections/topics — at any
// nesting depth — then approve. Editing the plan here is cheap; regenerating a
// whole course is not. The full recursive tree is rendered: sub-topics are the
// substance of the plan, not a footnote count.

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
type GoalCoverageConcept = { concept: string; covered: boolean; matched_topic: string | null }
type Curriculum = {
  title?: string
  branches?: AnyBranch[]
  goal_coverage_report?: { concepts?: GoalCoverageConcept[] } | null
  [k: string]: unknown
}

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

// Every node in a subtree, including the root topic itself.
function countSubtree(topic: AnyTopic): number {
  let n = 1
  for (const child of Array.isArray(topic.children) ? topic.children : []) {
    n += countSubtree(child)
  }
  return n
}

// Full recursive count — grandchildren and deeper all count.
function countTopics(curriculum: Curriculum): number {
  let n = 0
  for (const b of curriculum.branches ?? []) {
    for (const s of b.sections ?? []) {
      for (const t of s.topics ?? []) n += countSubtree(t)
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

function newTopic(title = 'New topic'): AnyTopic {
  return {
    id: slugify(`${title} ${Date.now()}`),
    title,
    description: '',
    prerequisites: [],
    depth: 'medium',
    estimated_pages: 3,
    node_type: 'learning_unit',
    children: [],
    initial_state: 'locked',
  }
}

// Case-insensitive check that a concept phrase appears somewhere in the tree.
function treeHasTitle(curriculum: Curriculum, phrase: string): boolean {
  const needle = phrase.trim().toLowerCase()
  if (!needle) return true
  let found = false
  const visit = (t: AnyTopic) => {
    if (found) return
    if ((t.title ?? '').toLowerCase().includes(needle)) { found = true; return }
    for (const c of Array.isArray(t.children) ? t.children : []) visit(c)
  }
  for (const b of curriculum.branches ?? []) {
    for (const s of b.sections ?? []) {
      for (const t of s.topics ?? []) visit(t)
    }
  }
  return found
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
  // Collapsed topic paths — everything starts expanded so the real size of the
  // plan is visible. Keys are `${bi}.${si}.${path.join('.')}`.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Coverage concepts the learner has dismissed by hand.
  const [dismissedConcepts, setDismissedConcepts] = useState<Set<string>>(new Set())

  const topicCount = useMemo(() => countTopics(curr), [curr])
  const branchCount = curr.branches?.length ?? 0

  // Concepts the goal named that the plan (currently) doesn't cover. Re-checked
  // against the live tree so adding/renaming a topic clears the warning.
  const missingConcepts = useMemo(() => {
    const concepts = curr.goal_coverage_report?.concepts ?? []
    return concepts.filter(
      (c) =>
        !c.covered &&
        !dismissedConcepts.has(c.concept) &&
        !treeHasTitle(curr, c.concept),
    )
  }, [curr, dismissedConcepts])

  // ── Mutators (all immutable) ──────────────────────────────────────────────
  function mutate(fn: (draft: Curriculum) => void) {
    setCurr((prev) => {
      const draft = clone(prev)
      fn(draft)
      return draft
    })
  }

  // The topics array a nested path points INTO. `parentPath` walks children.
  function topicsAt(d: Curriculum, bi: number, si: number, parentPath: number[]): AnyTopic[] {
    let arr = d.branches![bi].sections![si].topics!
    for (const i of parentPath) {
      const t = arr[i]
      if (!Array.isArray(t.children)) t.children = []
      arr = t.children
    }
    return arr
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

  const setTopicTitleAt = (bi: number, si: number, path: number[], v: string) =>
    mutate((d) => {
      const arr = topicsAt(d, bi, si, path.slice(0, -1))
      arr[path[path.length - 1]].title = v
    })

  const deleteTopicAt = (bi: number, si: number, path: number[]) =>
    mutate((d) => {
      const arr = topicsAt(d, bi, si, path.slice(0, -1))
      arr.splice(path[path.length - 1], 1)
    })

  const moveTopicAt = (bi: number, si: number, path: number[], dir: -1 | 1) =>
    mutate((d) => {
      const parentPath = path.slice(0, -1)
      const index = path[path.length - 1]
      const arr = topicsAt(d, bi, si, parentPath)
      const moved = move(arr, index, dir)
      if (parentPath.length === 0) {
        d.branches![bi].sections![si].topics = moved
      } else {
        const parentArr = topicsAt(d, bi, si, parentPath.slice(0, -1))
        parentArr[parentPath[parentPath.length - 1]].children = moved
      }
    })

  const addTopicAt = (bi: number, si: number, parentPath: number[], title?: string) =>
    mutate((d) => {
      topicsAt(d, bi, si, parentPath).push(newTopic(title))
    })

  // Missing concept → real topic at the end of the last branch's last section.
  const addMissingConcept = (concept: string) => {
    mutate((d) => {
      const branches = d.branches ?? []
      if (branches.length === 0) return
      const branch = branches[branches.length - 1]
      const sections = branch.sections!
      sections[sections.length - 1].topics!.push(newTopic(concept))
    })
  }

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
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

  // ── Recursive topic rows ──────────────────────────────────────────────────
  function renderTopics(topics: AnyTopic[], bi: number, si: number, parentPath: number[]) {
    return (
      <ul className={parentPath.length === 0 ? 'curriculum-topics' : 'curriculum-topics curriculum-subtopics'}>
        {topics.map((topic, ti) => {
          const path = [...parentPath, ti]
          const key = `${bi}.${si}.${path.join('.')}`
          const children = Array.isArray(topic.children) ? topic.children : []
          const hasChildren = children.length > 0
          const isCollapsed = collapsed.has(key)
          const subtreeSize = countSubtree(topic) - 1

          return (
            <li key={key}>
              <div className="curriculum-topic" data-depth={parentPath.length}>
                {hasChildren ? (
                  <button
                    type="button"
                    className={`curriculum-topic-toggle${isCollapsed ? '' : ' open'}`}
                    onClick={() => toggleCollapsed(key)}
                    title={isCollapsed ? 'Show sub-topics' : 'Hide sub-topics'}
                    aria-label={isCollapsed ? 'Show sub-topics' : 'Hide sub-topics'}
                    aria-expanded={!isCollapsed}
                  >
                    <IconChevronRight size={13} stroke={2.2} />
                  </button>
                ) : (
                  <span className="curriculum-topic-num">{ti + 1}</span>
                )}
                <div className="curriculum-topic-fields">
                  <input
                    className="curriculum-topic-title"
                    value={topic.title ?? ''}
                    onChange={(e) => setTopicTitleAt(bi, si, path, e.target.value)}
                    placeholder="Topic title"
                    aria-label="Topic title"
                  />
                  {hasChildren && isCollapsed ? (
                    <span className="curriculum-topic-children">
                      {subtreeSize} sub-topic{subtreeSize !== 1 ? 's' : ''}
                    </span>
                  ) : null}
                </div>
                <div className="curriculum-row-actions">
                  <button
                    type="button"
                    onClick={() => addTopicAt(bi, si, path)}
                    title="Add sub-topic"
                    aria-label="Add sub-topic"
                  >
                    <IconPlus size={14} stroke={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTopicAt(bi, si, path, -1)}
                    disabled={ti === 0}
                    title="Move up"
                    aria-label="Move topic up"
                  >
                    <IconChevronUp size={14} stroke={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTopicAt(bi, si, path, 1)}
                    disabled={ti === topics.length - 1}
                    title="Move down"
                    aria-label="Move topic down"
                  >
                    <IconChevronDown size={14} stroke={2} />
                  </button>
                  <button
                    type="button"
                    className="curriculum-delete"
                    onClick={() => deleteTopicAt(bi, si, path)}
                    title={hasChildren ? 'Delete topic and its sub-topics' : 'Delete topic'}
                    aria-label="Delete topic"
                  >
                    <IconTrash size={14} stroke={1.8} />
                  </button>
                </div>
              </div>
              {hasChildren && !isCollapsed
                ? renderTopics(children, bi, si, path)
                : null}
            </li>
          )
        })}
      </ul>
    )
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

      {missingConcepts.length > 0 ? (
        <div className="curriculum-coverage-warning" role="status">
          <strong>You asked for these, but they aren&rsquo;t in the plan yet:</strong>
          <ul>
            {missingConcepts.map((c) => (
              <li key={c.concept}>
                <span>{c.concept}</span>
                <div className="curriculum-coverage-actions">
                  <button type="button" onClick={() => addMissingConcept(c.concept)}>
                    Add as topic
                  </button>
                  <button
                    type="button"
                    className="curriculum-coverage-dismiss"
                    onClick={() =>
                      setDismissedConcepts((prev) => new Set(prev).add(c.concept))
                    }
                  >
                    Skip
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

                    {renderTopics(topics, bi, si, [])}

                    <button type="button" className="curriculum-add-topic" onClick={() => addTopicAt(bi, si, [])}>
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
