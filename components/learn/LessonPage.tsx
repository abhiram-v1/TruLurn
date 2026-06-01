import type { Page } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { LessonSections, type SectionOverride } from '@/components/learn/LessonSections'

export function LessonPage({
  page,
  topicTitle,
  content,
  screenPage,
  screenPageCount,
  sectionOverrides,
  onRestoreSection,
}: {
  page: Page
  topicTitle: string
  content: string
  screenPage: number
  screenPageCount: number
  sectionOverrides?: Map<number, SectionOverride>
  onRestoreSection?: (idx: number) => void
}) {
  const isStructured = Boolean(page.sections && page.sections.length > 0)

  return (
    <div className="lesson-content">
      <article className="lesson-inner">
        {isStructured ? (
          <LessonSections
            sections={page.sections!}
            topicDepth={page.topic_depth}
            conceptKind={page.concept_kind}
            sectionOverrides={sectionOverrides}
            onRestoreSection={onRestoreSection}
          />
        ) : (
          <>
            <div className="lesson-kicker">{topicTitle}</div>
            {screenPageCount > 1 ? (
              <div className="lesson-page-label">
                Part {screenPage} of {screenPageCount}
              </div>
            ) : null}
            <div className="lesson-body markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
              >
                {content}
              </ReactMarkdown>
            </div>
          </>
        )}
      </article>
    </div>
  )
}
