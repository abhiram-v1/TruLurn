'use client'

import {
  IconArrowRight,
  IconBook2,
  IconBrain,
  IconBinaryTree,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconChartDots3,
  IconCompass,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconFlag3,
  IconLock,
  IconMap2,
  IconNetwork,
  IconRoute,
  IconTags,
  IconTopologyStar3,
  IconTrash,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Topic } from '@/types'
import type { LessonConceptNavPage } from '@/components/learn/LessonConceptNavigator'

// Rotating set of geometric glyphs for section medallions — same pool used by
// the Atlas branch nodes, so the two curriculum views read as one system.
const SECTION_GLYPHS: Icon[] = [
  IconCompass,
  IconRoute,
  IconBinaryTree,
  IconNetwork,
  IconBrain,
  IconChartDots3,
  IconTopologyStar3,
]

type TaggedReminder = {
  id: string
  courseId: string
  recallSessionId: string
  recallItemId: string
  prompt: string
  concept: string
  type: 'recall' | 'connection' | 'application'
  topicId: string
  topicTitle: string
  pageNumber: number | null
  taggedAt: string
}

function isContainer(topic: Topic) {
  return topic.node_type === 'container' || Number(topic.children_count ?? 0) > 0
}

function topicIsCurrentPath(topic: Topic, currentTopicId: string) {
  return topic.id === currentTopicId || (topic.path_ids ?? []).includes(currentTopicId)
}

// States that count as "behind you" for progress purposes.
const COMPLETE_STATES = new Set(['mastered', 'functional', 'done'])

function isComplete(topic: Topic) {
  return COMPLETE_STATES.has(String(topic.state))
}

// Status marker strung on the thread: green check (done), pulsing accent
// (current), outlined accent core (available), lock (locked).
function TopicMarker({ state }: { state: string }) {
  if (state === 'done') {
    return <span className="tk-mk tk-mk--done" aria-hidden="true"><IconCheck size={11} stroke={2.6} /></span>
  }
  if (state === 'current') {
    return (
      <span className="tk-mk tk-mk--current" aria-hidden="true">
        <span className="tk-mk-pulse" />
        <span className="tk-mk-core" />
      </span>
    )
  }
  if (state === 'available') {
    return <span className="tk-mk tk-mk--avail" aria-hidden="true"><span className="tk-mk-core" /></span>
  }
  return <span className="tk-mk tk-mk--locked" aria-hidden="true"><IconLock size={9} stroke={2} /></span>
}

function sortTopics(topics: Topic[]) {
  return [...topics].sort((a, b) => {
    const aSeq = Number.isFinite(Number(a.sequence_index)) ? Number(a.sequence_index) : Number.MAX_SAFE_INTEGER
    const bSeq = Number.isFinite(Number(b.sequence_index)) ? Number(b.sequence_index) : Number.MAX_SAFE_INTEGER
    if (aSeq !== bSeq) return aSeq - bSeq

    return Number(a.position ?? 0) - Number(b.position ?? 0)
  })
}

function initialExpandedTopics(topics: Topic[], currentTopicId: string) {
  const current = topics.find((topic) => topic.id === currentTopicId)
  const ids = new Set<string>()
  if (!current) return ids

  const parentIds = (current.path_ids ?? []).filter((id) => id !== currentTopicId)
  parentIds.forEach((id) => ids.add(id))
  if (isContainer(current)) ids.add(current.id)
  return ids
}

export function MiniRoadmap({
  topics,
  currentTopicId,
  courseId,
  courseTitle,
  collapsed = false,
  onToggle,
  currentPageNumber,
  totalPlannedPages,
  conceptPages,
}: {
  topics: Topic[]
  currentTopicId: string
  courseId: string
  courseTitle?: string
  collapsed?: boolean
  onToggle?: () => void
  /** Page the learner is reading inside the current topic (1-based). */
  currentPageNumber?: number
  /** Planned page count of the current topic. */
  totalPlannedPages?: number
  /** Per-page concepts for the current topic — powers the "in this topic" page list. */
  conceptPages?: LessonConceptNavPage[]
}) {
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(
    () => initialExpandedTopics(topics, currentTopicId),
  )
  // Sections start collapsed except the one the learner is inside — the rail
  // stays scannable while everything else remains one click away.
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const current = topics.find((topic) => topic.id === currentTopicId)
    const fallback = topics[0]?.section
    const initial = current?.section ?? fallback
    return new Set(initial ? [initial] : [])
  })
  const [panelView, setPanelView] = useState<'map' | 'tagged'>('map')
  const [taggedReminders, setTaggedReminders] = useState<TaggedReminder[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsError, setTagsError] = useState<string | null>(null)
  const currentRowRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const sections = Array.from(new Set(topics.map((topic) => topic.section)))
  const currentTopic = topics.find((topic) => topic.id === currentTopicId)
  const visibleRailTopics = topics.slice(0, 12)
  const hasRecursiveTraccia = topics.some((topic) =>
    Boolean(topic.parent_id || topic.node_type || topic.children_count || topic.path_ids?.length),
  )

  const topicById = new Map(topics.map((topic) => [topic.id, topic]))
  const childrenByParent = new Map<string, Topic[]>()
  for (const topic of topics) {
    if (!topic.parent_id) continue
    const children = childrenByParent.get(topic.parent_id) ?? []
    children.push(topic)
    childrenByParent.set(topic.parent_id, children)
  }
  for (const [parentId, children] of childrenByParent) {
    childrenByParent.set(parentId, sortTopics(children))
  }

  // ── Journey context: progress + what comes after the current topic ──
  const teachable = sortTopics(topics.filter((topic) => !isContainer(topic)))
  const completedCount = teachable.filter(isComplete).length
  const progressPct = teachable.length ? Math.round((completedCount / teachable.length) * 100) : 0
  const currentIndex = teachable.findIndex((topic) => topic.id === currentTopicId)
  const nextTopic = currentIndex >= 0 ? teachable[currentIndex + 1] ?? null : null

  const loadTaggedReminders = useCallback(async () => {
    setTagsLoading(true)
    setTagsError(null)
    try {
      const res = await fetch(`/api/recall/tags?courseId=${encodeURIComponent(courseId)}`)
      const data = await res.json()
      if (!res.ok) {
        setTagsError(typeof data.error === 'string' ? data.error : 'Could not load tagged reminders.')
        return
      }
      setTaggedReminders(Array.isArray(data.reminders) ? data.reminders : [])
    } catch {
      setTagsError('Could not load tagged reminders.')
    } finally {
      setTagsLoading(false)
    }
  }, [courseId])

  // Prefetch the reminder list so switching views feels immediate.
  useEffect(() => {
    void loadTaggedReminders()
  }, [loadTaggedReminders])

  // Tagging happens inside the recall overlay; update Traccia without waiting
  // for another network read.
  useEffect(() => {
    function handleTagged(event: Event) {
      const reminder = (event as CustomEvent<TaggedReminder>).detail
      if (!reminder || reminder.courseId !== courseId) return
      setTaggedReminders((current) => [
        reminder,
        ...current.filter((item) => item.id !== reminder.id),
      ])
    }
    window.addEventListener('trulurn:tagged-reminder', handleTagged)
    return () => window.removeEventListener('trulurn:tagged-reminder', handleTagged)
  }, [courseId])

  // Keep the current topic visible — the list can hold dozens of topics.
  useEffect(() => {
    if (collapsed) return
    currentRowRef.current?.scrollIntoView({ block: 'center' })
  }, [currentTopicId, collapsed])

  // Prefetch the next and previous adjacent topics so clicking them is instant.
  useEffect(() => {
    if (!nextTopic) return
    const prefetchHref = `/learn/${courseId}/${encodeURIComponent(nextTopic.id)}`
    const run = () => { router.prefetch(prefetchHref) }
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run, { timeout: 3000 })
    } else {
      setTimeout(run, 500)
    }
  }, [nextTopic, courseId, router])

  function toggleTopic(topicId: string) {
    setExpandedTopicIds((current) => {
      const next = new Set(current)
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
      }
      return next
    })
  }

  function toggleSection(section: string) {
    setOpenSections((current) => {
      const next = new Set(current)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  // Page progress shown under the current topic row ("Page 3 of 7") when
  // there is no per-page list to render instead.
  function currentPageProgress() {
    if (!currentPageNumber || !totalPlannedPages || totalPlannedPages < 1) return null
    const pct = Math.min(100, Math.round((currentPageNumber / totalPlannedPages) * 100))
    return (
      <div className="topic-page-progress" aria-label={`Page ${currentPageNumber} of ${totalPlannedPages}`}>
        <span className="tpp-bar"><span style={{ width: `${pct}%` }} /></span>
        <span className="tpp-text">Page {currentPageNumber} of {totalPlannedPages}</span>
      </div>
    )
  }

  // "In this topic" page list — shown under the current topic, mirrors the
  // per-page concept nav that already lives in the lesson panel.
  function renderCurrentTopicPages(topic: Topic) {
    if (!conceptPages || !conceptPages.length) return null
    const active = currentPageNumber ?? 1
    return (
      <div className="traccia-pages-panel" aria-label={`Pages in ${topic.title}`}>
        <div className="traccia-pages-head">
          <span>In this topic</span>
          <span className="traccia-pages-count">Page {active} / {conceptPages.length}</span>
        </div>
        {conceptPages.map((pg) => {
          const state = pg.page_number < active ? 'done' : pg.page_number === active ? 'current' : 'todo'
          const label = pg.concepts?.[0] || pg.summary || `Page ${pg.page_number}`
          return (
            <Link
              key={pg.id}
              className={`traccia-page-row is-${state}`}
              href={`/learn/${courseId}/${topic.id}?page=${pg.page_number}`}
              prefetch={false}
            >
              <span className="traccia-page-pip">
                {state === 'done' ? <IconCheck size={9} stroke={3} /> : pg.page_number}
              </span>
              <span className="traccia-page-name">{label}</span>
            </Link>
          )
        })}
      </div>
    )
  }

  function renderTopicRow(topic: Topic, level = 0) {
    const current = topic.id === currentTopicId
    const currentPath = topicIsCurrentPath(topic, currentTopicId)
    const container = isContainer(topic)
    const expanded = expandedTopicIds.has(topic.id)
    const children = childrenByParent.get(topic.id) ?? []
    const markerState = current ? 'current'
      : isComplete(topic) ? 'done'
      : topic.state === 'active' ? 'available'
      : 'locked'

    if (container) {
      const locked = topic.state === 'locked'
      // Progress through this lesson: all teachable descendants, not just
      // direct children (containers can nest).
      const descendants = topics.filter(
        (t) => !isContainer(t) && (t.path_ids ?? []).includes(topic.id),
      )
      const teachableChildren = descendants.length
        ? descendants
        : children.filter((child) => !isContainer(child))
      const doneCount = teachableChildren.filter(isComplete).length
      const total = teachableChildren.length
      const containsCurrent = teachableChildren.some((t) => t.id === currentTopicId)
      const done = total > 0 && doneCount === total
      const lit = total ? Math.min(1, (doneCount + (containsCurrent ? 0.5 : 0)) / total) : 0
      return (
        <div
          className={`traccia-lesson level-${Math.min(level, 2)} ${currentPath ? 'is-current-path' : ''} ${locked ? 'is-locked' : ''}`}
          key={topic.id}
        >
          <button
            aria-expanded={expanded}
            className="traccia-lesson-head"
            disabled={locked}
            onClick={() => toggleTopic(topic.id)}
            type="button"
          >
            <span className={`traccia-lesson-node ${currentPath ? 'active' : ''} ${done ? 'done' : ''}`} aria-hidden="true" />
            <span className="traccia-lesson-copy">
              <span className="traccia-lesson-title">{topic.title}</span>
              {total ? (
                <span className="traccia-lesson-sub">
                  <span className="traccia-lesson-frac">{doneCount}/{total}</span>
                  <span className="traccia-lesson-minibar" aria-hidden="true">
                    <i style={{ width: `${lit * 100}%` }} />
                  </span>
                </span>
              ) : null}
            </span>
            {locked ? (
              <IconLock className="traccia-lesson-lock" aria-label="Locked" size={13} stroke={1.8} />
            ) : expanded ? (
              <IconChevronDown className="traccia-lesson-chevron" aria-hidden="true" size={15} stroke={1.8} />
            ) : (
              <IconChevronRight className="traccia-lesson-chevron" aria-hidden="true" size={15} stroke={1.8} />
            )}
          </button>
          {expanded && children.length ? (
            <div className="traccia-topic-thread" style={{ '--lit': lit } as CSSProperties}>
              <span className="traccia-topics-lit" aria-hidden="true" />
              {children.map((child) => renderTopicRow(child, level + 1))}
            </div>
          ) : null}
        </div>
      )
    }

    const row = (
      <>
        <TopicMarker state={markerState} />
        <span className="traccia-topic-copy">
          <span className="traccia-topic-title">{topic.title}</span>
          {current ? (
            <span className="tk-here">
              <IconBook2 size={11} stroke={1.9} aria-hidden="true" /> Reading now
            </span>
          ) : null}
          {current && !(conceptPages && conceptPages.length) ? currentPageProgress() : null}
        </span>
      </>
    )

    return (
      <Fragment key={topic.id}>
        <div
          className={`traccia-topic-row level-${Math.min(level, 2)} ${current ? 'is-current' : ''} ${isComplete(topic) ? 'is-done' : ''} ${topic.state === 'locked' ? 'is-locked' : ''}`}
          ref={current ? currentRowRef : undefined}
        >
          {topic.state === 'locked' ? (
            <div className="traccia-topic-link" aria-disabled="true">{row}</div>
          ) : (
            <Link
              className="traccia-topic-link"
              href={`/learn/${courseId}/${topic.id}`}
            >
              {row}
            </Link>
          )}
        </div>
        {current ? renderCurrentTopicPages(topic) : null}
      </Fragment>
    )
  }

  function sectionProgress(section: string) {
    const inSection = teachable.filter((topic) => topic.section === section)
    if (!inSection.length) return null
    const done = inSection.filter(isComplete).length
    return (
      <span className="roadmap-section-count">
        {done}/{inSection.length}
      </span>
    )
  }

  async function removeTaggedReminder(reminderId: string) {
    const previous = taggedReminders
    setTaggedReminders((current) => current.filter((reminder) => reminder.id !== reminderId))
    try {
      const res = await fetch(
        `/api/recall/tags?courseId=${encodeURIComponent(courseId)}&reminderId=${encodeURIComponent(reminderId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) setTaggedReminders(previous)
    } catch {
      setTaggedReminders(previous)
    }
  }

  function renderTaggedReminders() {
    return (
      <div className="tagged-reminders-view">
        <div className="tagged-reminders-intro">
          <strong>Return to what felt uncertain</strong>
          <span>Each reminder opens the exact lesson that prompted it.</span>
        </div>

        {tagsLoading ? (
          <div className="tagged-reminders-state" role="status">Loading reminders...</div>
        ) : tagsError ? (
          <div className="tagged-reminders-state is-error" role="alert">
            <span>{tagsError}</span>
            <button type="button" onClick={() => void loadTaggedReminders()}>Retry</button>
          </div>
        ) : taggedReminders.length ? (
          <div className="tagged-reminders-list">
            {taggedReminders.map((reminder) => {
              const href = `/learn/${courseId}/${reminder.topicId}${reminder.pageNumber ? `?page=${reminder.pageNumber}` : ''}`
              return (
                <div className="tagged-reminder-row" key={reminder.id}>
                  <Link className="tagged-reminder-link" href={href} prefetch>
                    <span className="tagged-reminder-concept">
                      <IconTags aria-hidden="true" size={13} stroke={1.8} />
                      {reminder.concept || reminder.topicTitle}
                    </span>
                    <span className="tagged-reminder-prompt">{reminder.prompt}</span>
                    <span className="tagged-reminder-source">
                      {reminder.topicTitle}
                      {reminder.pageNumber ? ` · Page ${reminder.pageNumber}` : ''}
                      <IconArrowRight aria-hidden="true" size={13} stroke={2} />
                    </span>
                  </Link>
                  <button
                    className="tagged-reminder-remove"
                    type="button"
                    aria-label={`Remove reminder for ${reminder.concept || reminder.topicTitle}`}
                    title="Remove tagged reminder"
                    onClick={() => void removeTaggedReminder(reminder.id)}
                  >
                    <IconTrash aria-hidden="true" size={14} stroke={1.7} />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="tagged-reminders-state">
            <IconTags aria-hidden="true" size={22} stroke={1.5} />
            <strong>No tagged reminders yet</strong>
            <span>Tag a recall prompt when you want to revisit its source later.</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="roadmap-header">
        {!collapsed ? (
          <div className="traccia-heading">
            <p className="panel-label">{panelView === 'map' ? 'Traccia' : 'Tagged reminders'}</p>
            {panelView === 'map' ? (
              <span className="traccia-heading-note">{courseTitle || 'Course path'}</span>
            ) : null}
          </div>
        ) : null}
        <div className="roadmap-header-actions">
          {!collapsed ? (
            <button
              className="panel-toggle roadmap-view-toggle"
              type="button"
              onClick={() => setPanelView((view) => view === 'map' ? 'tagged' : 'map')}
              aria-label={panelView === 'map' ? 'Show tagged reminders' : 'Show Traccia map'}
              title={panelView === 'map' ? 'Show tagged reminders' : 'Show Traccia map'}
              aria-pressed={panelView === 'tagged'}
            >
              {panelView === 'map' ? (
                <IconTags aria-hidden="true" size={17} stroke={1.8} />
              ) : (
                <IconMap2 aria-hidden="true" size={17} stroke={1.8} />
              )}
            </button>
          ) : null}
          <button
            className="panel-toggle roadmap-toggle"
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand Traccia' : 'Collapse Traccia'}
            title={collapsed ? 'Expand Traccia' : 'Collapse Traccia'}
          >
            {collapsed ? (
              <IconLayoutSidebarLeftExpand aria-hidden="true" size={18} stroke={1.8} />
            ) : (
              <IconLayoutSidebarLeftCollapse aria-hidden="true" size={18} stroke={1.8} />
            )}
          </button>
        </div>
      </div>

      {collapsed ? (
        <>
          <div className="roadmap-rail" aria-label="Collapsed Traccia">
            {visibleRailTopics.map((topic) => {
              const current = topic.id === currentTopicId
              const dotState = current ? 'active' : topic.state

              return (
                <Link
                  className={`roadmap-rail-dot ${current ? 'current' : ''}`}
                  href={`/learn/${courseId}/${topic.id}`}
                  key={topic.id}
                  title={topic.title}
                >
                  <span className={`state-dot ${dotState}`} />
                </Link>
              )
            })}
          </div>
        </>
      ) : panelView === 'tagged' ? (
        renderTaggedReminders()
      ) : (
        <>
          {/* Course progress — always visible above the list */}
          <div className="roadmap-progress" aria-label={`${completedCount} of ${teachable.length} topics completed`}>
            <div className="roadmap-progress-bar">
              <span style={{ width: `${progressPct}%` }} />
            </div>
            <span className="roadmap-progress-text"><b>{completedCount}</b> of {teachable.length} topics</span>
            <span className="roadmap-progress-pct">{progressPct}%</span>
          </div>

          <div className="roadmap-scroll">
            {sections.map((section, sectionIndex) => {
              const sectionTopics = teachable.filter((topic) => topic.section === section)
              const isCurrentSection = currentTopic?.section === section
              const isLockedSection = sectionTopics.length > 0
                && sectionTopics.every((topic) => topic.state === 'locked')
              const isDoneSection = !isCurrentSection && sectionTopics.length > 0
                && sectionTopics.every(isComplete)
              const sectionDoneCount = sectionTopics.filter(isComplete).length
              const sectionLit = sectionTopics.length
                ? Math.min(1, (sectionDoneCount + (isCurrentSection ? 0.5 : 0)) / sectionTopics.length)
                : 0
              const sectionLabelId = `traccia-section-${sectionIndex}`
              const Glyph = SECTION_GLYPHS[sectionIndex % SECTION_GLYPHS.length]
              const sectionOpen = openSections.has(section)

              return (
                <section
                  aria-labelledby={sectionLabelId}
                  className={`traccia-section ${isCurrentSection ? 'section-current' : ''} ${isLockedSection ? 'section-locked' : ''} ${isDoneSection ? 'section-done' : ''}`}
                  key={section}
                >
                  <button
                    aria-expanded={sectionOpen}
                    className="traccia-section-head"
                    id={sectionLabelId}
                    onClick={() => toggleSection(section)}
                    type="button"
                  >
                    <span className="traccia-section-marker" aria-hidden="true">
                      <Glyph size={16} stroke={1.7} />
                      {isDoneSection ? (
                        <span className="traccia-section-badge"><IconCheck size={9} stroke={3} /></span>
                      ) : isLockedSection ? (
                        <span className="traccia-section-badge is-locked"><IconLock size={8} stroke={2.2} /></span>
                      ) : null}
                    </span>
                    <span className="traccia-section-copy">
                      <span className="traccia-section-name">{section}</span>
                      <span className="traccia-section-meta">
                        {sectionProgress(section)}
                        {isCurrentSection ? <span className="traccia-section-here">You are here</span> : null}
                      </span>
                    </span>
                    {sectionOpen ? (
                      <IconChevronUp className="traccia-section-chevron" aria-hidden="true" size={16} stroke={1.8} />
                    ) : (
                      <IconChevronDown className="traccia-section-chevron" aria-hidden="true" size={16} stroke={1.8} />
                    )}
                  </button>
                  {sectionOpen ? (
                    <div className="traccia-section-thread" style={{ '--lit': sectionLit } as CSSProperties}>
                      {hasRecursiveTraccia ? (
                        sortTopics(topics.filter((topic) => {
                          if (topic.section !== section) return false
                          return !topic.parent_id || !topicById.has(topic.parent_id)
                        })).map((topic) => renderTopicRow(topic))
                      ) : (
                        sortTopics(topics.filter((topic) => topic.section === section))
                          .map((topic) => renderTopicRow(topic))
                      )}
                    </div>
                  ) : null}
                  {sectionOpen && sectionIndex === sections.length - 1 ? (
                    <div className="traccia-route-destination" aria-hidden="true">
                      <IconFlag3 size={15} stroke={1.8} />
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>

          {/* Journey footer — what comes after this topic */}
          <div className="roadmap-footer-stack">
            {nextTopic ? (
              <Link className="roadmap-next" href={`/learn/${courseId}/${nextTopic.id}`}>
                <span className="roadmap-next-icon-shell" aria-hidden="true">
                  <IconBook2 size={16} stroke={1.8} />
                </span>
                <span className="roadmap-next-copy">
                  <span className="roadmap-next-label">Up next</span>
                  <span className="roadmap-next-title">{nextTopic.title}</span>
                </span>
                <IconArrowRight size={15} stroke={2} className="roadmap-next-arrow" aria-hidden="true" />
              </Link>
            ) : currentIndex >= 0 ? (
              <div className="roadmap-next is-locked">
                <span className="roadmap-next-label">Up next</span>
                <span className="roadmap-next-title">Final topic — you&apos;re at the end of the path</span>
              </div>
            ) : null}
            <Link className="roadmap-graph-link" href={`/graph/${courseId}`}>
              <IconTopologyStar3 size={13} stroke={1.8} /> Open knowledge graph
            </Link>
          </div>
        </>
      )}
    </>
  )
}
