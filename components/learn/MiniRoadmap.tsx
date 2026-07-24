'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Topic } from '@/types'
import type { LessonConceptNavPage } from '@/components/learn/LessonConceptNavigator'

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

const COMPLETE_STATES = new Set(['mastered', 'functional', 'done'])

function isContainer(topic: Topic) {
  return topic.node_type === 'container' || Number(topic.children_count ?? 0) > 0
}

function isComplete(topic: Topic) {
  return COMPLETE_STATES.has(String(topic.state))
}

function topicIsCurrentPath(topic: Topic, currentTopicId: string) {
  return topic.id === currentTopicId || (topic.path_ids ?? []).includes(currentTopicId)
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
  for (const id of (current.path_ids ?? []).filter((pathId) => pathId !== currentTopicId)) ids.add(id)
  if (isContainer(current)) ids.add(current.id)
  return ids
}

function topicStatus(topic: Topic, current: boolean) {
  if (current) return 'reading'
  if (isComplete(topic)) return 'done'
  if (topic.state === 'locked') return 'locked'
  return 'next'
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
  currentPageNumber?: number
  totalPlannedPages?: number
  conceptPages?: LessonConceptNavPage[]
}) {
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(
    () => initialExpandedTopics(topics, currentTopicId),
  )
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const current = topics.find((topic) => topic.id === currentTopicId)
    const initial = current?.section ?? topics[0]?.section
    return new Set(initial ? [initial] : [])
  })
  const [panelView, setPanelView] = useState<'map' | 'tagged'>('map')
  const [taggedReminders, setTaggedReminders] = useState<TaggedReminder[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [tagsError, setTagsError] = useState<string | null>(null)
  const currentRowRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const sections = Array.from(new Set(topics.map((topic) => topic.section)))
  const currentTopic = topics.find((topic) => topic.id === currentTopicId)
  const teachable = sortTopics(topics.filter((topic) => !isContainer(topic)))
  const completedCount = teachable.filter(isComplete).length
  const progressPct = teachable.length ? Math.round((completedCount / teachable.length) * 100) : 0
  const currentIndex = teachable.findIndex((topic) => topic.id === currentTopicId)
  const nextTopic = currentIndex >= 0 ? teachable[currentIndex + 1] ?? null : null
  const visibleRailTopics = teachable.slice(0, 12)

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

  const loadTaggedReminders = useCallback(async () => {
    setTagsLoading(true)
    setTagsError(null)
    try {
      const response = await fetch(`/api/recall/tags?courseId=${encodeURIComponent(courseId)}`)
      const data = await response.json()
      if (!response.ok) {
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

  useEffect(() => {
    if (collapsed) return
    currentRowRef.current?.scrollIntoView({ block: 'center' })
  }, [currentTopicId, collapsed])

  useEffect(() => {
    if (!nextTopic) return
    const href = `/learn/${courseId}/${encodeURIComponent(nextTopic.id)}`
    const run = () => { router.prefetch(href) }
    if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(run, { timeout: 3000 })
    else setTimeout(run, 500)
  }, [nextTopic, courseId, router])

  function toggleTopic(topicId: string) {
    setExpandedTopicIds((current) => {
      const next = new Set(current)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

  function toggleSection(section: string) {
    setOpenSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  function openPanelView(view: 'map' | 'tagged') {
    setPanelView(view)
    if (view === 'tagged' && !taggedReminders.length && !tagsLoading) void loadTaggedReminders()
  }

  function renderCurrentTopicPages(topic: Topic) {
    if (!conceptPages?.length) {
      if (!currentPageNumber || !totalPlannedPages) return null
      return (
        <div className="traccia-explorer-page-summary">
          Page {currentPageNumber} of {totalPlannedPages}
        </div>
      )
    }

    const active = currentPageNumber ?? 1
    return (
      <div className="traccia-explorer-pages" aria-label={`Pages in ${topic.title}`}>
        {conceptPages.map((page) => {
          const state = page.page_number < active ? 'done' : page.page_number === active ? 'reading' : 'next'
          const label = page.concepts?.[0] || page.summary || `Page ${page.page_number}`
          return (
            <Link
              key={page.id}
              className={`traccia-explorer-page is-${state}`}
              href={`/learn/${courseId}/${topic.id}?page=${page.page_number}`}
              prefetch={false}
              aria-current={state === 'reading' ? 'page' : undefined}
            >
              <span className="traccia-explorer-index">{String(page.page_number).padStart(2, '0')}</span>
              <span className="traccia-explorer-row-title">{label}</span>
              <span className="traccia-explorer-status">{state}</span>
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

    if (container) {
      const locked = topic.state === 'locked'
      const descendants = topics.filter(
        (candidate) => !isContainer(candidate) && (candidate.path_ids ?? []).includes(topic.id),
      )
      const teachableChildren = descendants.length
        ? descendants
        : children.filter((child) => !isContainer(child))
      const doneCount = teachableChildren.filter(isComplete).length
      const total = teachableChildren.length

      return (
        <div
          className={`traccia-explorer-group level-${Math.min(level, 2)} ${currentPath ? 'is-current-path' : ''} ${locked ? 'is-locked' : ''}`}
          key={topic.id}
        >
          <button
            aria-expanded={locked ? undefined : expanded}
            className="traccia-explorer-group-row"
            disabled={locked}
            onClick={() => toggleTopic(topic.id)}
            type="button"
          >
            <span className="traccia-explorer-row-title">{topic.title}</span>
            <span className="traccia-explorer-fraction">{total ? `${doneCount}/${total}` : ''}</span>
            {locked ? <span className="traccia-explorer-status">locked</span> : null}
          </button>
          {expanded && children.length ? (
            <div className="traccia-explorer-children">
              {children.map((child) => renderTopicRow(child, level + 1))}
            </div>
          ) : null}
        </div>
      )
    }

    const status = topicStatus(topic, current)
    const content = (
      <>
        <span className="traccia-explorer-row-title">{topic.title}</span>
        <span className="traccia-explorer-status">{status}</span>
      </>
    )

    return (
      <Fragment key={topic.id}>
        <div
          className={`traccia-explorer-topic level-${Math.min(level, 2)} is-${status}`}
          ref={current ? currentRowRef : undefined}
        >
          {topic.state === 'locked' ? (
            <div className="traccia-explorer-topic-row" aria-disabled="true">{content}</div>
          ) : (
            <Link
              className="traccia-explorer-topic-row"
              href={`/learn/${courseId}/${topic.id}`}
              aria-current={current ? 'page' : undefined}
            >
              {content}
            </Link>
          )}
        </div>
        {current ? renderCurrentTopicPages(topic) : null}
      </Fragment>
    )
  }

  async function removeTaggedReminder(reminderId: string) {
    const previous = taggedReminders
    setTaggedReminders((current) => current.filter((reminder) => reminder.id !== reminderId))
    try {
      const response = await fetch(
        `/api/recall/tags?courseId=${encodeURIComponent(courseId)}&reminderId=${encodeURIComponent(reminderId)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) setTaggedReminders(previous)
    } catch {
      setTaggedReminders(previous)
    }
  }

  function renderTaggedReminders() {
    return (
      <div className="traccia-explorer-reminders">
        <div className="traccia-explorer-reminder-intro">
          <strong>Tagged reminders</strong>
          <span>Return to the lesson that prompted each note.</span>
        </div>
        {tagsLoading ? (
          <div className="traccia-explorer-empty" role="status">Loading reminders...</div>
        ) : tagsError ? (
          <div className="traccia-explorer-empty is-error" role="alert">
            <span>{tagsError}</span>
            <button type="button" onClick={() => void loadTaggedReminders()}>Retry</button>
          </div>
        ) : taggedReminders.length ? (
          <div className="traccia-explorer-reminder-list">
            {taggedReminders.map((reminder) => {
              const href = `/learn/${courseId}/${reminder.topicId}${reminder.pageNumber ? `?page=${reminder.pageNumber}` : ''}`
              return (
                <div className="traccia-explorer-reminder" key={reminder.id}>
                  <Link href={href} prefetch>
                    <strong>{reminder.concept || reminder.topicTitle}</strong>
                    <span>{reminder.prompt}</span>
                    <small>{reminder.topicTitle}{reminder.pageNumber ? ` · Page ${reminder.pageNumber}` : ''}</small>
                  </Link>
                  <button type="button" onClick={() => void removeTaggedReminder(reminder.id)}>
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="traccia-explorer-empty">
            <strong>No tagged reminders</strong>
            <span>Tag a recall prompt and it will appear here.</span>
          </div>
        )}
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="traccia-collapsed">
        <button className="traccia-collapsed-open" type="button" onClick={onToggle} aria-label="Expand Traccia">
          Open
        </button>
        <nav className="traccia-collapsed-list" aria-label="Collapsed Traccia topics">
          {visibleRailTopics.map((topic, index) => {
            const current = topic.id === currentTopicId
            return topic.state === 'locked' ? (
              <span className="traccia-collapsed-item is-locked" key={topic.id} title={`${topic.title} — locked`}>
                {String(index + 1).padStart(2, '0')}
              </span>
            ) : (
              <Link
                className={`traccia-collapsed-item ${current ? 'is-current' : ''}`}
                href={`/learn/${courseId}/${topic.id}`}
                key={topic.id}
                title={topic.title}
                aria-current={current ? 'page' : undefined}
              >
                {String(index + 1).padStart(2, '0')}
              </Link>
            )
          })}
        </nav>
      </div>
    )
  }

  return (
    <div className="traccia-explorer">
      <header className="traccia-explorer-header">
        <div className="traccia-explorer-heading">
          <p>Traccia</p>
          <span>{courseTitle || 'Course path'}</span>
        </div>
        <div className="traccia-explorer-actions">
          <button
            type="button"
            onClick={() => openPanelView(panelView === 'map' ? 'tagged' : 'map')}
            aria-pressed={panelView === 'tagged'}
          >
            {panelView === 'map' ? 'Reminders' : 'Course'}
          </button>
          <button type="button" onClick={onToggle} aria-label="Collapse Traccia">Hide</button>
        </div>
      </header>

      {panelView === 'tagged' ? renderTaggedReminders() : (
        <>
          <div className="traccia-explorer-progress" aria-label={`${completedCount} of ${teachable.length} topics completed`}>
            <span><strong>{completedCount}</strong> of {teachable.length} topics</span>
            <span>{progressPct}%</span>
          </div>

          <nav className="traccia-explorer-scroll" aria-label="Course outline">
            {sections.map((section, sectionIndex) => {
              const sectionTopics = teachable.filter((topic) => topic.section === section)
              const doneCount = sectionTopics.filter(isComplete).length
              const isCurrentSection = currentTopic?.section === section
              const isLockedSection = sectionTopics.length > 0 && sectionTopics.every((topic) => topic.state === 'locked')
              const isDoneSection = !isCurrentSection && sectionTopics.length > 0 && sectionTopics.every(isComplete)
              const sectionOpen = openSections.has(section)
              const sectionLabelId = `traccia-section-${sectionIndex}`

              return (
                <section
                  className={`traccia-explorer-section ${isCurrentSection ? 'is-current' : ''} ${isLockedSection ? 'is-locked' : ''} ${isDoneSection ? 'is-done' : ''}`}
                  key={section}
                  aria-labelledby={sectionLabelId}
                >
                  <button
                    aria-expanded={sectionOpen}
                    className="traccia-explorer-section-row"
                    id={sectionLabelId}
                    onClick={() => toggleSection(section)}
                    type="button"
                  >
                    <span className="traccia-explorer-index">{String(sectionIndex + 1).padStart(2, '0')}</span>
                    <span className="traccia-explorer-section-title">{section}</span>
                    <span className="traccia-explorer-fraction">{doneCount}/{sectionTopics.length}</span>
                  </button>

                  {sectionOpen ? (
                    <div className="traccia-explorer-section-content">
                      {(hasRecursiveTraccia
                        ? sortTopics(topics.filter((topic) => {
                            if (topic.section !== section) return false
                            return !topic.parent_id || !topicById.has(topic.parent_id)
                          }))
                        : sortTopics(topics.filter((topic) => topic.section === section))
                      ).map((topic) => renderTopicRow(topic))}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </nav>

          <footer className="traccia-explorer-footer">
            {nextTopic ? (
              <Link className="traccia-explorer-next" href={`/learn/${courseId}/${nextTopic.id}`}>
                <span>Up next</span>
                <strong>{nextTopic.title}</strong>
              </Link>
            ) : null}
            <Link className="traccia-explorer-graph" href={`/graph/${courseId}`}>Knowledge graph</Link>
          </footer>
        </>
      )}
    </div>
  )
}
