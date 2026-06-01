'use client'

import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from '@tabler/icons-react'
import Link from 'next/link'
import { useState } from 'react'
import type { Topic } from '@/types'

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
  const sections = Array.from(new Set(topics.map((topic) => topic.section)))
  const visibleRailTopics = topics.slice(0, 12)

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
                  {topics
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
                    })}
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
