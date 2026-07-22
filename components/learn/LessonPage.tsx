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
  globalPageNumber,
  globalPageTotal,
  sectionOverrides,
  onRestoreSection,
  children,
}: {
  page: Page
  topicTitle: string
  content: string
  screenPage: number
  screenPageCount: number
  globalPageNumber: number
  globalPageTotal: number
  sectionOverrides?: Map<number, SectionOverride>
  onRestoreSection?: (idx: number) => void
  children?: React.ReactNode
}) {
  const isStructured = Boolean(page.sections && page.sections.length > 0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const activeProcessing = page.active_processing ?? null
  const selfCheck = activeProcessing?.self_explanation_prompt
    ?? activeProcessing?.transfer_prompt
    ?? activeProcessing?.retrieval_prompt
    ?? null

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
        <header className="lesson-pdf-header">
          <div className="lesson-pdf-brand">
            {/* Native image loading is more reliable when the hidden print header becomes visible. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="lesson-pdf-logo"
              src="/trulurn-icon.svg"
              width={42}
              height={42}
              alt="TruLurn"
            />
            <div>
              <strong>TruLurn</strong>
              <span>AI-guided mastery</span>
            </div>
          </div>
          <div className="lesson-pdf-page-meta">
            <span>Lesson page {page.page_number}</span>
            <span>Course page {globalPageNumber} of {globalPageTotal}</span>
          </div>
          <div className="lesson-pdf-title">
            <span>Lesson</span>
            <h1>{topicTitle}</h1>
            {screenPageCount > 1 ? (
              <small>Part {screenPage} of {screenPageCount}</small>
            ) : null}
          </div>
        </header>

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

        {screenPage === screenPageCount && selfCheck ? (
          <aside className="lesson-self-check" aria-label="Check your understanding">
            <span>Check yourself</span>
            <p>{selfCheck}</p>
          </aside>
        ) : null}

        {page.source_citations?.length ? (
          <details className="lesson-source-citations">
            <summary>Sources used on this page</summary>
            <ol>
              {page.source_citations.map((citation) => (
                <li key={citation.citation_id}>
                  <strong>[{citation.citation_id}]</strong>{' '}
                  <span>{citation.source_title}</span>
                  {citation.heading_path.length ? (
                    <small>{citation.heading_path.join(' > ')}</small>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}

        {children && (
          <div
            className="lesson-feedback-slot"
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
