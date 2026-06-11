import { useEffect, useRef, useState } from 'react'
import type { Page } from '@/types'
import { LessonSections, type SectionOverride } from '@/components/learn/LessonSections'
import { MarkdownContent } from '@/components/ui/MarkdownContent'

export function LessonPage({
  page,
  topicTitle,
  content,
  screenPage,
  screenPageCount,
  sectionOverrides,
  onRestoreSection,
  children,
}: {
  page: Page
  topicTitle: string
  content: string
  screenPage: number
  screenPageCount: number
  sectionOverrides?: Map<number, SectionOverride>
  onRestoreSection?: (idx: number) => void
  children?: React.ReactNode
}) {
  const isStructured = Boolean(page.sections && page.sections.length > 0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showFeedback, setShowFeedback] = useState(false)

  // Reset showFeedback when the page changes
  useEffect(() => {
    setShowFeedback(false)
  }, [page.page_number])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleScroll() {
      if (!el) return
      if (el.clientHeight === 0) return

      // Detect if user has scrolled near the bottom of the page content
      const isBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60
      if (isBottom) {
        setShowFeedback(true)
      }
    }

    // Check initial scroll state
    handleScroll()
    const timer = setTimeout(handleScroll, 100)

    el.addEventListener('scroll', handleScroll)
    const observer = new ResizeObserver(() => handleScroll())
    observer.observe(el)

    return () => {
      clearTimeout(timer)
      el.removeEventListener('scroll', handleScroll)
      observer.disconnect()
    }
  }, [page, content])

  return (
    <div className="lesson-content" ref={containerRef}>
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
              <MarkdownContent>{content}</MarkdownContent>
            </div>
          </>
        )}

        {children && (
          <div
            style={{
              opacity: showFeedback ? 1 : 0,
              visibility: showFeedback ? 'visible' : 'hidden',
              transition: 'opacity 0.4s ease-in-out, visibility 0.4s ease-in-out',
              pointerEvents: showFeedback ? 'auto' : 'none',
              marginTop: '40px',
            }}
          >
            {children}
          </div>
        )}
      </article>
    </div>
  )
}
