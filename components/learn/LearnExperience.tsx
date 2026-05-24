'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { DoubtChat } from '@/components/learn/DoubtChat'
import { LessonPage } from '@/components/learn/LessonPage'
import { MiniRoadmap } from '@/components/learn/MiniRoadmap'
import { ThreePanelLayout } from '@/components/learn/ThreePanelLayout'
import { BottomNav } from '@/components/navigation/BottomNav'
import type { DoubtMessage, Page, Topic } from '@/types'

export function LearnExperience({
  courseId,
  topic,
  topics,
  page,
  totalPages,
  initialMessages,
}: {
  courseId: string
  topic: Topic
  topics: Topic[]
  page: Page
  totalPages: number
  initialMessages: DoubtMessage[]
}) {
  const [content, setContent] = useState(page.content)

  const livePage = useMemo<Page>(
    () => ({ ...page, content }),
    [content, page],
  )

  const prev = Math.max(1, page.page_number - 1)
  const next = Math.min(totalPages, page.page_number + 1)
  const isFirst = page.page_number === 1
  const isLast = page.page_number === totalPages

  function rewrite(type: 'simplify' | 'deeper' | 'example') {
    const additions = {
      simplify:
        'Simplified: think of linear regression as drawing the most useful straight line through messy data points, then measuring how wrong that line is on average.',
      deeper:
        'Deeper: the line is a hypothesis about the data-generating process. Training is a search over parameter space to minimise expected loss across the full distribution of examples.',
      example:
        'Example: if study hours predict exam score, the slope says how much the predicted score changes per extra hour. The bias is the base prediction before any hours are counted.',
    }
    setContent((c) => `${c}\n\n${additions[type]}`)
  }

  return (
    <div className="study-shell">
      <ThreePanelLayout
        left={
          <MiniRoadmap
            topics={topics}
            currentTopicId={topic.id}
            courseId={courseId}
          />
        }
        middle={
          <>
            {/* Lesson toolbar — topic title centered, small label on left */}
            <div className="lesson-toolbar">
              <span className="panel-label">Lesson</span>
              <span className="lesson-toolbar-topic">{topic.title}</span>
              {/* Quiz shortcut on far right */}
              <Link
                className="lesson-quiz-link"
                href={`/quiz/${topic.id}`}
                title="Go to quiz for this topic"
              >
                Quiz ↗
              </Link>
            </div>

            {/* Scrollable lesson content */}
            <LessonPage
              page={livePage}
              topicTitle={topic.title}
              totalPages={totalPages}
            />

            {/* Single compact footer — nav + controls in one bar */}
            <div className="lesson-footer">
              {/* Prev */}
              {isFirst ? (
                <button className="lesson-nav-btn" type="button" disabled>
                  ← Prev
                </button>
              ) : (
                <Link
                  className="lesson-nav-btn"
                  href={`/learn/${courseId}/${topic.id}?page=${prev}`}
                >
                  ← Prev
                </Link>
              )}

              {/* Page indicator */}
              <span className="lesson-page-pos">
                {page.page_number} / {totalPages}
              </span>

              {/* Rewrite controls — segmented pill */}
              <div className="lesson-ctrl-group" role="group" aria-label="Page controls">
                <button
                  className="lesson-ctrl"
                  type="button"
                  onClick={() => rewrite('simplify')}
                  title="Rewrite this page in simpler language"
                >
                  Simplify
                </button>
                <button
                  className="lesson-ctrl"
                  type="button"
                  onClick={() => rewrite('deeper')}
                  title="Add more technical depth to this page"
                >
                  Deeper
                </button>
                <button
                  className="lesson-ctrl"
                  type="button"
                  onClick={() => rewrite('example')}
                  title="Add a worked example"
                >
                  Example
                </button>
              </div>

              {/* Next or quiz CTA */}
              {isLast ? (
                <Link
                  className="lesson-nav-btn lesson-nav-quiz"
                  href={`/quiz/${topic.id}`}
                >
                  Take quiz →
                </Link>
              ) : (
                <Link
                  className="lesson-nav-btn"
                  href={`/learn/${courseId}/${topic.id}?page=${next}`}
                >
                  Next →
                </Link>
              )}
            </div>
          </>
        }
        right={
          <DoubtChat
            topicId={topic.id}
            topicTitle={topic.title}
            pageNumber={page.page_number}
            initialMessages={initialMessages}
          />
        }
      />
      <BottomNav courseId={courseId} />
    </div>
  )
}
