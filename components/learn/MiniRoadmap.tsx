'use client'

import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLock,
  IconTopologyStar3,
} from '@tabler/icons-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Topic } from '@/types'

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
  const [lockedTopicId, setLockedTopicId] = useState<string | null>(null)
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(
    () => initialExpandedTopics(topics, currentTopicId),
  )
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
  const nextIsLocked = nextTopic?.state === 'locked'

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
    const locked = topic.state === 'locked'
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
        ) : locked ? (
          <button
            className={`topic-locked ${current ? 'current' : ''}`}
            type="button"
            onClick={() => setLockedTopicId(lockedTopicId === topic.id ? null : topic.id)}
          >
            <span className={`state-dot ${dotState}`} />
            <span className="topic-name">{topic.title}</span>
            {rowAdornment(topic, current)}
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

        {lockedTopicId === topic.id ? (
          <div className="locked-message">
            Complete{' '}
            <strong>
              {topicById.get(topic.prerequisites[0])?.title ?? 'the prerequisite topic'}
            </strong>{' '}
            first.
          </div>
        ) : null}

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

  return (
    <>
      <div className="roadmap-header">
        {!collapsed ? <p className="panel-label">Traccia</p> : null}
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

      {collapsed ? (
        <>
          <div className="roadmap-rail" aria-label="Collapsed Traccia">
            {visibleRailTopics.map((topic) => {
              const current = topic.id === currentTopicId
              const dotState = current ? 'active' : topic.state
              const locked = topic.state === 'locked'

              if (locked) {
                return (
                  <button
                    className={`roadmap-rail-dot ${current ? 'current' : ''}`}
                    key={topic.id}
                    type="button"
                    title={topic.title}
                    onClick={() => setLockedTopicId(topic.id)}
                  >
                    <span className={`state-dot ${dotState}`} />
                  </button>
                )
              }

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
          {lockedTopicId ? (
            <div className="roadmap-rail-hint" role="status">
              Locked
            </div>
          ) : null}
        </>
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
              nextIsLocked ? (
                <div className="roadmap-next is-locked" title="Unlocks as you progress">
                  <span className="roadmap-next-label">Up next</span>
                  <span className="roadmap-next-title">
                    <IconLock size={12} stroke={1.8} /> {nextTopic.title}
                  </span>
                </div>
              ) : (
                <Link className="roadmap-next" href={`/learn/${courseId}/${nextTopic.id}`}>
                  <span className="roadmap-next-label">Up next</span>
                  <span className="roadmap-next-title">
                    {nextTopic.title} <IconArrowRight size={13} stroke={2} className="roadmap-next-arrow" />
                  </span>
                </Link>
              )
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
