'use client'

import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLock,
  IconMap2,
  IconTags,
  IconTopologyStar3,
  IconTrash,
} from '@tabler/icons-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Topic } from '@/types'

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
  collapsed = false,
  onToggle,
  currentPageNumber,
  totalPlannedPages,
}: {
  topics: Topic[]
  currentTopicId: string
  courseId: string
  collapsed?: boolean
  onToggle?: () => void
  /** Page the learner is reading inside the current topic (1-based). */
  currentPageNumber?: number
  /** Planned page count of the current topic. */
  totalPlannedPages?: number
}) {
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(
    () => initialExpandedTopics(topics, currentTopicId),
  )
  const [panelView, setPanelView] = useState<'map' | 'tagged'>('map')
  const [taggedReminders, setTaggedReminders] = useState<TaggedReminder[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsError, setTagsError] = useState<string | null>(null)
  const currentRowRef = useRef<HTMLDivElement>(null)
  const sections = Array.from(new Set(topics.map((topic) => topic.section)))
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

  function rowAdornment(topic: Topic, current: boolean) {
    if (topic.state === 'locked') {
      return <IconLock className="topic-adorn" size={12} stroke={1.8} aria-label="Locked" />
    }
    if (isComplete(topic)) {
      return <IconCheck className="topic-adorn complete" size={13} stroke={2.2} aria-label="Completed" />
    }
    return null
  }

  // Page progress shown under the current topic row ("Page 3 of 7").
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

  function renderTopicRow(topic: Topic, level = 0) {
    const current = topic.id === currentTopicId
    const currentPath = topicIsCurrentPath(topic, currentTopicId)
    const container = isContainer(topic)
    const expanded = expandedTopicIds.has(topic.id)
    const children = childrenByParent.get(topic.id) ?? []
    const dotState = current ? 'active' : topic.state

    return (
      <div
        className={`topic-tree-row level-${Math.min(level, 2)}`}
        key={topic.id}
        ref={current ? currentRowRef : undefined}
      >
        {container ? (
          <button
            className={`topic-container ${currentPath ? 'current-path' : ''} ${current ? 'current' : ''}`}
            type="button"
            onClick={() => toggleTopic(topic.id)}
          >
            <span className={`state-dot ${dotState}`} />
            <span className="topic-name">{topic.title}</span>
            <span className="topic-expander" aria-hidden="true">
              {expanded ? <IconChevronDown size={14} stroke={1.8} /> : <IconChevronRight size={14} stroke={1.8} />}
            </span>
          </button>
        ) : (
          <Link
            className={`topic-link ${current ? 'current' : ''}`}
            href={`/learn/${courseId}/${topic.id}`}
          >
            <span className={`state-dot ${dotState}`} />
            <span className="topic-name">{topic.title}</span>
            {rowAdornment(topic, current)}
          </Link>
        )}

        {current && !container ? currentPageProgress() : null}

        {container && expanded && children.length ? (
          <div className="topic-child-list">
            {children.map((child) => renderTopicRow(child, level + 1))}
          </div>
        ) : null}
      </div>
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
        {!collapsed ? <p className="panel-label">{panelView === 'map' ? 'Traccia' : 'Tagged reminders'}</p> : null}
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
            <span className="roadmap-progress-text">
              {completedCount}/{teachable.length} topics
            </span>
          </div>

          <div className="roadmap-scroll">
            {sections.map((section) => (
              <div className="topic-group" key={section}>
                <div className="roadmap-section-label">
                  <span className="roadmap-section-name">{section}</span>
                  {sectionProgress(section)}
                </div>
                <div className="topic-list">
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
              </div>
            ))}
          </div>

          {/* Journey footer — what comes after this topic */}
          <div className="roadmap-footer-stack">
            {nextTopic ? (
              <Link className="roadmap-next" href={`/learn/${courseId}/${nextTopic.id}`}>
                <span className="roadmap-next-label">Up next</span>
                <span className="roadmap-next-title">
                  {nextTopic.title} <IconArrowRight size={13} stroke={2} className="roadmap-next-arrow" />
                </span>
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
