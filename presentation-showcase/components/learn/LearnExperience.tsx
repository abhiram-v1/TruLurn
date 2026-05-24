'use client'

import { useMemo, useState } from 'react'
import { DoubtChat } from '@/components/learn/DoubtChat'
import { LessonPage } from '@/components/learn/LessonPage'
import { MiniRoadmap } from '@/components/learn/MiniRoadmap'
import { PageControls } from '@/components/learn/PageControls'
import { PageNav } from '@/components/learn/PageNav'
import { ThreePanelLayout } from '@/components/learn/ThreePanelLayout'
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
    () => ({
      ...page,
      content,
    }),
    [content, page],
  )

  function rewrite(type: 'simplify' | 'deeper' | 'example') {
    const additions = {
      simplify:
        'Simplified version: think of linear regression as drawing the most useful straight line through messy points, then checking how wrong that line is.',
      deeper:
        'Deeper view: the line is a hypothesis about the data. Training is the process of searching for parameters that make this hypothesis less wrong across examples.',
      example:
        'Example: if study hours predict exam score, the slope says how much the predicted score changes for each extra hour, while the bias is the starting point before hours are counted.',
    }

    setContent((current) => `${current}\n\n${additions[type]}`)
  }

  return (
    <ThreePanelLayout
      left={<MiniRoadmap topics={topics} currentTopicId={topic.id} courseId={courseId} />}
      middle={
        <>
          <div className="lesson-toolbar">
            <span className="paginator">Stored lesson page</span>
            <PageControls onRewrite={rewrite} />
          </div>
          <LessonPage page={livePage} topicTitle={topic.title} totalPages={totalPages} />
          <PageNav
            currentPage={page.page_number}
            totalPages={totalPages}
            courseId={courseId}
            topicId={topic.id}
          />
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
  )
}
