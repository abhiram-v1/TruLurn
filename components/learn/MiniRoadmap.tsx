'use client'

import {
  IconChevronDown,
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from '@tabler/icons-react'
import Link from 'next/link'
import { useState } from 'react'
import type { Topic } from '@/types'

function isContainer(topic: Topic) {
  return topic.node_type === 'container' || Number(topic.children_count ?? 0) > 0
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
}: {
  topics: Topic[]
  currentTopicId: string
  courseId: string
  collapsed?: boolean
  onToggle?: () => void
}) {
  const [lockedTopicId, setLockedTopicId] = useState<string | null>(null)
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(
    () => initialExpandedTopics(topics, currentTopicId),
  )
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

  function renderTopicRow(topic: Topic, level = 0) {
    const locked = topic.state === 'locked'
    const current = topic.id === currentTopicId
    const currentPath = topicIsCurrentPath(topic, currentTopicId)
    const container = isContainer(topic)
    const expanded = expandedTopicIds.has(topic.id)
    const children = childrenByParent.get(topic.id) ?? []
    const dotState = current ? 'active' : topic.state

    return (
      <div className={`topic-tree-row level-${Math.min(level, 2)}`} key={topic.id}>
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
            onClick={() => setLockedTopicId(topic.id)}
          >
            <span className={`state-dot ${dotState}`} />
            <span className="topic-name">{topic.title}</span>
          </button>
        ) : (
          <Link
            className={`topic-link ${current ? 'current' : ''}`}
            href={`/learn/${courseId}/${topic.id}`}
          >
            <span className={`state-dot ${dotState}`} />
            <span className="topic-name">{topic.title}</span>
          </Link>
        )}

        {lockedTopicId === topic.id ? (
          <div className="locked-message">
            Complete {topic.prerequisites[0] ?? 'the prerequisite'} first.
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
          <div className="roadmap-scroll">
            {sections.map((section) => (
              <div className="topic-group" key={section}>
                <div className="roadmap-section-label">{section}</div>
                <div className="topic-list">
                  {hasRecursiveTraccia ? (
                    sortTopics(topics.filter((topic) => {
                      if (topic.section !== section) return false
                      return !topic.parent_id || !topicById.has(topic.parent_id)
                    })).map((topic) => renderTopicRow(topic))
                  ) : (
                    topics
                    .filter((topic) => topic.section === section)
                    .map((topic) => {
                      const locked = topic.state === 'locked'
                      const current = topic.id === currentTopicId
                      const dotState = current ? 'active' : topic.state

                      if (locked) {
                        return (
                          <div key={topic.id}>
                            <button
                              className="topic-locked"
                              type="button"
                              onClick={() => setLockedTopicId(topic.id)}
                            >
                              <span className={`state-dot ${dotState}`} />
                              <span className="topic-name">{topic.title}</span>
                            </button>
                            {lockedTopicId === topic.id ? (
                              <div className="locked-message">
                                Complete {topic.prerequisites[0] ?? 'the prerequisite'} first.
                              </div>
                            ) : null}
                          </div>
                        )
                      }

                      return (
                        <Link
                          className={`topic-link ${current ? 'current' : ''}`}
                          href={`/learn/${courseId}/${topic.id}`}
                          key={topic.id}
                        >
                          <span className={`state-dot ${dotState}`} />
                          <span className="topic-name">{topic.title}</span>
                        </Link>
                      )
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
          <Link className="roadmap-footer" href={`/graph/${courseId}`}>
            <span>Weakest connection</span>
            <strong>Feature scaling is isolated</strong>
          </Link>
        </>
      )}
    </>
  )
}
