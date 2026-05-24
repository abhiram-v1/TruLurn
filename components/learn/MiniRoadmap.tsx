'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Topic } from '@/types'

export function MiniRoadmap({
  topics,
  currentTopicId,
  courseId,
}: {
  topics: Topic[]
  currentTopicId: string
  courseId: string
}) {
  const [lockedTopicId, setLockedTopicId] = useState<string | null>(null)
  const sections = Array.from(new Set(topics.map((topic) => topic.section)))
  const currentBranch = topics[0]?.branch_id ?? 'branch'

  return (
    <>
      <div className="roadmap-header">
        <p className="panel-title">Roadmap</p>
        <span className="panel-corner" aria-hidden="true" />
      </div>
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
  )
}
