'use client'

import Link from 'next/link'
import { IconFileTypePdf } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { flushSync } from 'react-dom'
import { DoubtChat } from '@/components/learn/DoubtChat'
import { LessonPage } from '@/components/learn/LessonPage'
import { LessonFeedback } from '@/components/learn/LessonFeedback'
import { LessonConceptNavigator, type LessonConceptNavPage } from '@/components/learn/LessonConceptNavigator'
import { LessonPdfDocument, type LessonPdfEntry } from '@/components/learn/LessonPdfDocument'
import { LessonSelectionToolbar, type TransformAction } from '@/components/learn/LessonSelectionToolbar'
import type { SectionOverride } from '@/components/learn/LessonSections'
import { MiniRoadmap } from '@/components/learn/MiniRoadmap'
import { ThreePanelLayout } from '@/components/learn/ThreePanelLayout'
import { BackButton } from '@/components/navigation/BackButton'
import { BottomNav } from '@/components/navigation/BottomNav'
import {
  RecallBreakBanner,
  RecallBreakCountdown,
  RecallBreakOverlay,
} from '@/components/recall/RecallBreakOverlay'
import { useRecallBreak } from '@/components/recall/useRecallBreak'
import { paginateLessonMarkdown } from '@/lib/lesson-pagination'
import type { DoubtMessage, Page, Topic } from '@/types'

// ── Inline text replacement ───────────────────────────────────────────────────
// DOM-selected text and stored markdown diverge in whitespace: the DOM collapses
// `\n` paragraph breaks into spaces, and normalizeLessonMarkdown may insert `\n\n`
// inside long paragraphs. We handle this by building a regex that allows any
// run of whitespace where the selected text had a single space.
//
// Fallback strategy: if matching fails, APPEND the result rather than replacing
// the whole section — so existing content is never lost.

function spliceIntoMarkdown(source: string, selectedText: string, replacement: string): string {
  const trimmed = selectedText.trim()

  // 1. Exact match (fastest path — works when markdown has no newlines in the passage)
  if (source.includes(trimmed)) {
    return source.replace(trimmed, replacement)
  }

  // 2. Flexible-whitespace regex — handles \n vs space mismatch between DOM and markdown
  try {
    const pattern = trimmed
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex metacharacters
      .replace(/\s+/g, '\\s+')                 // any whitespace run matches
    const regex = new RegExp(pattern)
    const result = source.replace(regex, replacement)
    if (result !== source) return result
  } catch {
    // Invalid regex (e.g., the selected text has unbalanced brackets after escaping)
  }

  // 3. Safe fallback: append below a divider — content is never lost
  return `${source}\n\n---\n\n${replacement}`
}

export function LearnExperience({
  courseId,
  topic,
  topics,
  page,
  conceptPages,
  totalPages,
  estimatedPages,
  globalPageNumber,
  globalPageTotal,
  initialMessages,
  nextTopic,
}: {
  courseId: string
  topic: Topic
  topics: Topic[]
  page: Page
  conceptPages: LessonConceptNavPage[]
  totalPages: number
  estimatedPages: number
  globalPageNumber: number
  globalPageTotal: number
  initialMessages: DoubtMessage[]
  nextTopic?: Pick<Topic, 'id' | 'title'> | null
}) {
  const router = useRouter()
  const [roadmapCollapsed, setRoadmapCollapsed] = useState(false)
  const [doubtsExpanded, setDoubtsExpanded] = useState(false)
  const [lessonPageIndex, setLessonPageIndex] = useState(0)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [pdfEntries, setPdfEntries] = useState<LessonPdfEntry[]>([])
  const [pdfGlobalPageTotal, setPdfGlobalPageTotal] = useState(globalPageTotal)
  const [draftSeed, setDraftSeed] = useState<{ id: number; value: string } | null>(null)
  const [selectedChatContext, setSelectedChatContext] = useState<{ id: number; text: string } | null>(null)
  const [sectionOverrides, setSectionOverrides] = useState<Map<number, SectionOverride>>(new Map())

  const recall = useRecallBreak({
    courseId,
    topicId: topic.id,
    topicTitle: topic.title,
    pageNumber: page.page_number,
    keyConcepts: page.key_concepts,
    pageSummary: page.summary ?? null,
  })

  // Clear overrides whenever the page changes
  useEffect(() => {
    setSectionOverrides(new Map())
  }, [page.id])

  function applyInlineTransform(
    sectionIdx: number,
    selectedText: string,
    result: string,
    action: TransformAction,
  ) {
    if (!page.sections || sectionIdx < 0 || sectionIdx >= page.sections.length) return

    setSectionOverrides((prev) => {
      const currentContent = prev.get(sectionIdx)?.modified ?? page.sections![sectionIdx].content
      const original = prev.get(sectionIdx)?.original ?? page.sections![sectionIdx].content

      const modified = action === 'example'
        ? spliceIntoMarkdown(currentContent, selectedText, `${selectedText}\n\n${result}`)
        : spliceIntoMarkdown(currentContent, selectedText, result)

      return new Map(prev).set(sectionIdx, { original, modified, action })
    })
  }

  function restoreSection(sectionIdx: number) {
    setSectionOverrides((prev) => {
      const next = new Map(prev)
      next.delete(sectionIdx)
      return next
    })
  }

  async function regeneratePage(approach?: string) {
    if (isRegenerating) return
    setIsRegenerating(true)
    try {
      const res = await fetch(`/api/topics/${encodeURIComponent(topic.id)}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, pageNumber: page.page_number, force: true, approach }),
      })
      if (res.ok) router.refresh()
    } finally {
      setIsRegenerating(false)
    }
  }

  async function generateCustomPage(instruction: string, targetPageNumber: number) {
    if (isRegenerating) return
    setIsRegenerating(true)
    try {
      const res = await fetch(`/api/topics/${encodeURIComponent(topic.id)}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          pageNumber: targetPageNumber,
          force: true,
          customInstruction: instruction,
        }),
      })
      if (res.ok) router.refresh()
    } finally {
      setIsRegenerating(false)
    }
  }

  async function exportCurrentPageAsPdf() {
    if (isExportingPdf) return

    const previousTitle = document.title
    let restored = false

    const restoreDocument = () => {
      if (restored) return
      restored = true
      document.title = previousTitle
      document.body.classList.remove('trulurn-pdf-export')
      setIsExportingPdf(false)
    }

    setIsExportingPdf(true)
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/pages/export`)
      const payload = await response.json() as {
        courseTitle?: string
        globalPageTotal?: number
        entries?: LessonPdfEntry[]
        error?: string
      }
      if (!response.ok || !payload.entries?.length) {
        throw new Error(payload.error ?? 'No generated pages are available to export.')
      }

      flushSync(() => {
        setPdfEntries(payload.entries!)
        setPdfGlobalPageTotal(payload.globalPageTotal ?? globalPageTotal)
      })

      document.title = `TruLurn - ${payload.courseTitle ?? topic.title}`
      document.body.classList.add('trulurn-pdf-export')
      window.addEventListener('afterprint', restoreDocument, { once: true })

      const logos = Array.from(document.querySelectorAll<HTMLImageElement>('.lesson-pdf-logo'))
      await Promise.all(logos.map(async (logo) => {
        if (logo.complete) return
        try {
          await logo.decode()
        } catch {
          // Printing can continue with the text brand if an image cannot decode.
        }
      }))

      window.dispatchEvent(new Event('resize'))
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      window.print()
      window.setTimeout(restoreDocument, 60_000)
    } catch (error) {
      console.error('PDF export failed:', error)
      restoreDocument()
    }
  }

  // Structured pages (new format) render all sections at once — no sub-pagination.
  // Legacy flat-markdown pages (old format) are split into screen-sized chunks.
  const isStructured = Boolean(page.sections && page.sections.length > 0)
  const lessonPages = useMemo(
    () => isStructured ? [page.content] : paginateLessonMarkdown(page.content),
    [page.content, isStructured],
  )
  const currentLessonContent = lessonPages[lessonPageIndex] ?? lessonPages[0] ?? page.content

  // estimatedPages is plan-aware (topic.planned_pages once the lesson plan
  // exists) — trust it. No phantom "+1" page: a finished topic ends at its
  // last planned page and offers the quiz, instead of inviting the student
  // to mint extra pages for thin topics.
  const totalPlanned  = Math.max(totalPages, estimatedPages)
  const prev          = Math.max(1, page.page_number - 1)
  const next          = Math.min(totalPlanned, page.page_number + 1)
  const isFirst       = page.page_number === 1
  const isLast        = totalPages >= totalPlanned && page.page_number >= totalPlanned
  const isFirstScreen = lessonPageIndex === 0
  const isLastScreen  = lessonPageIndex === lessonPages.length - 1
  const pageMarkers = Array.from({ length: Math.min(totalPlanned, 15) }, (_, index) => index + 1)
  const hasScreenParts = lessonPages.length > 1

  useEffect(() => {
    setLessonPageIndex(0)
  }, [page.id])

  // One-ahead prefetch: while the student reads page N, silently generate page
  // N+1 so "Next" never waits — and never more than one unread page exists.
  // Reading a page takes far longer than generating one, so this stays seamless
  // while capping wasted generations (student leaves mid-topic) at a single page.
  // The server additionally hard-caps generation at the topic plan's page count.
  const prefetchedPagesRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    const nextPage = page.page_number + 1
    if (nextPage > Math.min(estimatedPages, 15)) return
    if (nextPage <= totalPages) return // already stored
    if (prefetchedPagesRef.current.has(nextPage)) return
    prefetchedPagesRef.current.add(nextPage)

    fetch(`/api/topics/${encodeURIComponent(topic.id)}/pages/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, pageNumber: nextPage }),
    }).catch(() => {
      // Allow a retry on the next page change if the prefetch failed.
      prefetchedPagesRef.current.delete(nextPage)
    })
  }, [page.page_number, topic.id, courseId, estimatedPages, totalPages])

  return (
    <div className="study-shell">
      <ThreePanelLayout
        roadmapCollapsed={roadmapCollapsed}
        doubtsExpanded={doubtsExpanded}
        left={
          <MiniRoadmap
            topics={topics}
            currentTopicId={topic.id}
            courseId={courseId}
            collapsed={roadmapCollapsed}
            onToggle={() => setRoadmapCollapsed((collapsed) => !collapsed)}
            currentPageNumber={page.page_number}
            totalPlannedPages={totalPlanned}
          />
        }
        middle={
          <>
            <div className="lesson-toolbar">
              <BackButton fallbackHref={`/course/${courseId}`} />
              <span className="panel-label">Lesson</span>
              <span className="lesson-toolbar-topic">{topic.title}</span>
              <button
                className="lesson-regen-btn lesson-export-btn"
                type="button"
                onClick={exportCurrentPageAsPdf}
                disabled={isExportingPdf}
                title="Export every generated page in this course as one PDF"
              >
                <IconFileTypePdf aria-hidden="true" size={15} stroke={1.8} />
                <span>{isExportingPdf ? 'Preparing...' : 'Export PDF'}</span>
              </button>
              <button
                className="lesson-regen-btn"
                type="button"
                onClick={() => recall.startBreak(true)}
                disabled={recall.loading || Boolean(recall.overlay) || Boolean(recall.rest)}
                title="Pause and actively recall what you covered in this session"
              >
                {recall.loading ? 'Preparing…' : '◉ Recall'}
              </button>
              <button
                className="lesson-regen-btn"
                type="button"
                onClick={() => regeneratePage()}
                disabled={isRegenerating}
                title="Delete and regenerate this page with fresh AI content"
              >
                {isRegenerating ? 'Regenerating…' : '↺ Regen'}
              </button>
            </div>

            {recall.breakDue && !recall.overlay && !recall.rest ? (
              <RecallBreakBanner
                reason={recall.breakReason}
                durationMinutes={recall.breakDurationMinutes}
                loading={recall.loading}
                onStart={() => recall.startBreak(false)}
                onSnooze={recall.snoozeBreak}
                onSkip={recall.skipBreak}
              />
            ) : null}
            {recall.error && !recall.overlay ? (
              <div className="recall-inline-error">{recall.error}</div>
            ) : null}

            <LessonPage
              page={page}
              topicTitle={topic.title}
              content={currentLessonContent}
              screenPage={lessonPageIndex + 1}
              screenPageCount={lessonPages.length}
              globalPageNumber={globalPageNumber}
              globalPageTotal={globalPageTotal}
              sectionOverrides={sectionOverrides}
              onRestoreSection={restoreSection}
            >
              <LessonFeedback
                courseId={courseId}
                topicId={topic.id}
                pageNumber={page.page_number}
                onReexplain={regeneratePage}
                isRegenerating={isRegenerating}
              />
            </LessonPage>
            <LessonConceptNavigator
              courseId={courseId}
              topicId={topic.id}
              currentPageNumber={page.page_number}
              pages={conceptPages}
            />
            <LessonSelectionToolbar
              topicId={topic.id}
              courseId={courseId}
              topicTitle={topic.title}
              onTransformComplete={applyInlineTransform}
              onAttachToChat={(text) => {
                setSelectedChatContext({ id: Date.now(), text })
                setDoubtsExpanded(true)
              }}
            />

            <div className="lesson-footer">
              {isFirstScreen && isFirst ? (
                <button className="lesson-nav-btn" type="button" disabled>
                  Prev
                </button>
              ) : isFirstScreen ? (
                <Link
                  className="lesson-nav-btn"
                  href={`/learn/${courseId}/${topic.id}?page=${prev}`}
                >
                  Prev
                </Link>
              ) : (
                <button
                  className="lesson-nav-btn"
                  type="button"
                  onClick={() => setLessonPageIndex((index) => Math.max(0, index - 1))}
                >
                  Prev
                </button>
              )}

              <div className="lesson-page-meter" aria-label="Lesson pages">
                <span className="lesson-page-pos">
                  Page {page.page_number} of {totalPlanned}
                </span>
                <div className="lesson-page-dots" aria-hidden="true">
                  {pageMarkers.map((pageNumber) => (
                    <span
                      className={[
                        pageNumber === page.page_number ? 'active' : '',
                        pageNumber <= totalPages ? 'generated' : 'planned',
                      ].filter(Boolean).join(' ')}
                      key={`${topic.id}-page-${pageNumber}`}
                    />
                  ))}
                </div>
                {hasScreenParts ? (
                  <span className="lesson-page-context">
                    Course page {globalPageNumber} of {globalPageTotal} - Part {lessonPageIndex + 1} of {lessonPages.length}
                  </span>
                ) : (
                  <span className="lesson-page-context">
                    Course page {globalPageNumber} of {globalPageTotal}
                  </span>
                )}
              </div>

              <div className="lesson-footer-actions">
                {!isLastScreen ? (
                  <button
                    className="lesson-nav-btn lesson-nav-next"
                    type="button"
                    onClick={() => setLessonPageIndex((index) => Math.min(lessonPages.length - 1, index + 1))}
                  >
                    Next
                  </button>
                ) : isLast ? (
                  <>
                    <Link
                      className="lesson-nav-btn lesson-nav-quiz"
                      href={`/quiz/${encodeURIComponent(topic.id)}`}
                    >
                      Take quiz
                    </Link>
                    <Link
                      className="lesson-nav-btn lesson-nav-next"
                      href={nextTopic ? `/learn/${courseId}/${encodeURIComponent(nextTopic.id)}` : `/course/${courseId}`}
                      title={nextTopic ? `Skip quiz and continue to ${nextTopic.title}` : 'Return to Atlas'}
                    >
                      {nextTopic ? 'Next topic' : 'Atlas'}
                    </Link>
                  </>
                ) : (
                  <Link
                    className="lesson-nav-btn lesson-nav-next"
                    href={`/learn/${courseId}/${topic.id}?page=${next}`}
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          </>
        }
        right={
          <DoubtChat
            courseId={courseId}
            topicId={topic.id}
            topicTitle={topic.title}
            pageNumber={page.page_number}
            globalPageNumber={globalPageNumber}
            initialMessages={initialMessages}
            expanded={doubtsExpanded}
            onExpandedChange={setDoubtsExpanded}
            draftSeed={draftSeed}
            selectedContext={selectedChatContext}
            onClearSelectedContext={() => setSelectedChatContext(null)}
            onRegenerate={regeneratePage}
            onGenerateCustomPage={generateCustomPage}
          />
        }
      />
      {recall.rest ? <RecallBreakCountdown rest={recall.rest} /> : null}
      {recall.overlay ? (
        <RecallBreakOverlay
          content={recall.overlay}
          onComplete={recall.completeBreak}
          onTag={recall.tagReminder}
          onDismiss={recall.dismissOverlay}
        />
      ) : null}
      <LessonPdfDocument
        entries={pdfEntries}
        currentPageId={page.id}
        currentPageOverrides={sectionOverrides}
        globalPageTotal={pdfGlobalPageTotal}
      />
      <BottomNav courseId={courseId} />
    </div>
  )
}
