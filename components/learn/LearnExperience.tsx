'use client'

import Link from 'next/link'
import { IconFileTypePdf } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { QuizInviteBanner } from '@/components/quiz/QuizInviteBanner'
import { QuizNudgeBanner } from '@/components/quiz/QuizNudgeBanner'
import { useQuizNudge, type QuizNudgeData } from '@/components/quiz/useQuizNudge'
import { paginateLessonMarkdown } from '@/lib/lesson-pagination'
import {
  expandMarkdownSelectionToSentence,
  replaceMarkdownSelection,
  type MarkdownSelectionAnchor,
} from '@/lib/markdown-selection'
import { inferSelectionShape } from '@/lib/topic-transform'
import type { Page, Topic } from '@/types'

// ── Module-level page cache ───────────────────────────────────────────────────
// Lives outside React so it survives re-renders and soft navigations within the
// same browser session. Key: "topicId::pageNumber". Value: fetched Page object.
// The cache is unbounded — a 15-page topic at ~3KB/page is only ~45KB total.
const _pageCache = new Map<string, Page>()
const _pageCacheInflight = new Set<string>()

function pageCacheKey(topicId: string, pageNumber: number) {
  return `${topicId}::${pageNumber}`
}

async function fetchAndCachePage(
  topicId: string,
  pageNumber: number,
): Promise<{ page: Page; totalPages: number; estimatedPages: number } | null> {
  const key = pageCacheKey(topicId, pageNumber)
  const cached = _pageCache.get(key)
  if (cached) return { page: cached, totalPages: 0, estimatedPages: 0 }
  if (_pageCacheInflight.has(key)) return null
  _pageCacheInflight.add(key)
  try {
    const res = await fetch(
      `/api/topics/${encodeURIComponent(topicId)}/pages/${pageNumber}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = await res.json() as { page: Page; totalPages: number; estimatedPages: number }
    _pageCache.set(key, data.page)
    return data
  } catch {
    return null
  } finally {
    _pageCacheInflight.delete(key)
  }
}

export function LearnExperience({
  courseId,
  courseTitle,
  topic,
  topics,
  page,
  conceptPages,
  totalPages,
  estimatedPages,
  globalPageNumber,
  globalPageTotal,
  nextTopic,
  reviewGaps = [],
  learningControl,
  quizNudge,
}: {
  courseId: string
  courseTitle?: string
  topic: Topic
  topics: Topic[]
  page: Page
  conceptPages: LessonConceptNavPage[]
  totalPages: number
  estimatedPages: number
  globalPageNumber: number
  globalPageTotal: number
  nextTopic?: Pick<Topic, 'id' | 'title'> | null
  reviewGaps?: string[]
  learningControl?: string
  quizNudge?: QuizNudgeData | null
}) {
  const router = useRouter()
  const [roadmapCollapsed, setRoadmapCollapsed] = useState(false)
  const [doubtsExpanded, setDoubtsExpanded] = useState(false)
  const [quizBannerDismissed, setQuizBannerDismissed] = useState(false)
  const [lessonPageIndex, setLessonPageIndex] = useState(0)
  const [isPageChanging, setIsPageChanging] = useState(false)
  const [pageChangeError, setPageChangeError] = useState<string | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [pdfEntries, setPdfEntries] = useState<LessonPdfEntry[]>([])
  const [pdfGlobalPageTotal, setPdfGlobalPageTotal] = useState(globalPageTotal)
  const [draftSeed, setDraftSeed] = useState<{ id: number; value: string } | null>(null)
  const [selectedChatContext, setSelectedChatContext] = useState<{ id: number; text: string } | null>(null)
  const [sectionOverrides, setSectionOverrides] = useState<Map<number, SectionOverride>>(new Map())

  // ── Client-side page cache state ────────────────────────────────────────────
  // activePage starts as the SSR-provided page; cache-first navigation swaps it
  // instantly without a server round-trip.
  const [activePage, setActivePage] = useState<Page>(page)
  const [activeTotalPages, setActiveTotalPages] = useState(totalPages)
  const [activeEstimatedPages, setActiveEstimatedPages] = useState(estimatedPages)
  const activeGlobalPageNumber = Math.max(
    1,
    globalPageNumber + activePage.page_number - page.page_number,
  )
  // Scroll position memory: save scroll offset per page_number so going back
  // restores context.
  const scrollPositionsRef = useRef<Map<number, number>>(new Map())
  const lessonPanelRef = useRef<HTMLElement | null>(null)

  // Seed the cache with the SSR page so the first prev/next hit is already warm.
  useEffect(() => {
    _pageCache.set(pageCacheKey(topic.id, page.page_number), page)
  }, [page, topic.id])

  // Sync activePage when SSR sends a new page (e.g. after router.refresh() from regen)
  useEffect(() => {
    setActivePage(page)
    setActiveTotalPages(totalPages)
    setActiveEstimatedPages(estimatedPages)
    // Re-seed cache with fresh server data
    _pageCache.set(pageCacheKey(topic.id, page.page_number), page)
    setIsPageChanging(false)
  }, [page, totalPages, estimatedPages, topic.id])

  // Prefetch adjacent pages into the cache during browser idle time
  const prefetchPageToCache = useCallback((pageNum: number) => {
    const key = pageCacheKey(topic.id, pageNum)
    if (_pageCache.has(key) || _pageCacheInflight.has(key)) return
    const run = () => { fetchAndCachePage(topic.id, pageNum) }
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run, { timeout: 2000 })
    } else {
      setTimeout(run, 300)
    }
  }, [topic.id])

  // Prefetch N-1 and N+1 whenever the active page changes
  useEffect(() => {
    const cur = activePage.page_number
    if (cur > 1) prefetchPageToCache(cur - 1)
    if (cur < Math.min(activeTotalPages, activeEstimatedPages, 15)) {
      prefetchPageToCache(cur + 1)
    }
  }, [activePage.page_number, activeTotalPages, activeEstimatedPages, prefetchPageToCache])

  // Cache-first navigation: instantly show cached page, sync URL without SSR
  const handleNavToPage = useCallback(async (targetPageNumber: number) => {
    if (isPageChanging || targetPageNumber === activePage.page_number) return
    setPageChangeError(null)
    setIsPageChanging(true)

    // Save current scroll position
    const panel = lessonPanelRef.current ?? document.querySelector<HTMLElement>('.lesson-content')
    if (panel) {
      scrollPositionsRef.current.set(activePage.page_number, panel.scrollTop)
    }

    const key = pageCacheKey(topic.id, targetPageNumber)
    let targetPage = _pageCache.get(key)
    let freshMeta: { totalPages: number; estimatedPages: number } | null = null

    if (!targetPage) {
      const fresh = await fetchAndCachePage(topic.id, targetPageNumber)
      if (fresh) {
        targetPage = fresh.page
        freshMeta = {
          totalPages: fresh.totalPages,
          estimatedPages: fresh.estimatedPages,
        }
      }
    }

    if (!targetPage) {
      try {
        const generated = await fetch(`/api/topics/${encodeURIComponent(topic.id)}/pages/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, pageNumber: targetPageNumber }),
        })
        if (generated.ok) {
          const fresh = await fetchAndCachePage(topic.id, targetPageNumber)
          if (fresh) {
            targetPage = fresh.page
            freshMeta = {
              totalPages: fresh.totalPages,
              estimatedPages: fresh.estimatedPages,
            }
          }
        }
      } catch {
        // The route fallback below will render the existing generation/error UI.
      }
    }

    if (targetPage) {
      const nextPage = targetPage
      window.setTimeout(() => {
        setActivePage(nextPage)
        setLessonPageIndex(0)
        if (freshMeta?.totalPages) setActiveTotalPages(freshMeta.totalPages)
        if (freshMeta?.estimatedPages) setActiveEstimatedPages(freshMeta.estimatedPages)
        window.history.pushState(
          null,
          '',
          `/learn/${courseId}/${encodeURIComponent(topic.id)}?page=${targetPageNumber}`,
        )
        requestAnimationFrame(() => {
          const p = lessonPanelRef.current ?? document.querySelector<HTMLElement>('.lesson-content')
          if (p) {
            const saved = scrollPositionsRef.current.get(targetPageNumber)
            p.scrollTop = saved ?? 0
          }
          window.setTimeout(() => setIsPageChanging(false), 180)
        })
      }, 110)
      // Background: fetch fresh data in case the cache is stale (fire-and-forget)
      fetchAndCachePage(topic.id, targetPageNumber).then((fresh) => {
        if (fresh && fresh.totalPages > 0) {
          _pageCache.set(pageCacheKey(topic.id, targetPageNumber), fresh.page)
          // Only update state if totalPages changed (avoids unnecessary re-render)
          if (fresh.totalPages !== activeTotalPages) setActiveTotalPages(fresh.totalPages)
          if (fresh.estimatedPages !== activeEstimatedPages) setActiveEstimatedPages(fresh.estimatedPages)
        }
      })
    } else {
      setIsPageChanging(false)
      setPageChangeError('That page could not be opened. Please try again.')
      window.setTimeout(() => setPageChangeError(null), 3500)
    }
  }, [topic.id, courseId, activePage.page_number, activeTotalPages, activeEstimatedPages, router, isPageChanging])

  const recall = useRecallBreak({
    courseId,
    topicId: topic.id,
    topicTitle: topic.title,
    pageNumber: activePage.page_number,
    keyConcepts: activePage.key_concepts,
    pageSummary: activePage.summary ?? null,
  })

  const quizNudgeState = useQuizNudge({ courseId, learningControl, quizNudge })

  // Clear overrides whenever the page changes
  useEffect(() => {
    setSectionOverrides(new Map())
    setSelectedChatContext(null)
  }, [activePage.id])

  // Reset quiz banner when we navigate to a different topic
  useEffect(() => {
    setQuizBannerDismissed(false)
  }, [topic.id])

  function applyInlineTransform(
    sectionIdx: number,
    selection: MarkdownSelectionAnchor,
    result: string,
    action: TransformAction,
  ): boolean {
    if (!activePage.sections || sectionIdx < 0 || sectionIdx >= activePage.sections.length) return false

    const currentOverride = sectionOverrides.get(sectionIdx)
    const currentContent = currentOverride?.modified ?? activePage.sections[sectionIdx].content
    const replaced = replaceMarkdownSelection(currentContent, selection, result)
    if (!replaced) return false

    const original = currentOverride?.original ?? activePage.sections[sectionIdx].content
    setSectionOverrides((prev) => new Map(prev).set(sectionIdx, {
      original,
      modified: replaced.value,
      action,
    }))
    return true
  }

  function prepareInlineTransform(
    sectionIdx: number,
    selection: MarkdownSelectionAnchor,
  ): MarkdownSelectionAnchor | null {
    if (!activePage.sections || sectionIdx < 0 || sectionIdx >= activePage.sections.length) return null
    const currentContent = sectionOverrides.get(sectionIdx)?.modified ?? activePage.sections[sectionIdx].content
    if (inferSelectionShape(selection.before, selection.after) === 'passage') return selection
    return expandMarkdownSelectionToSentence(currentContent, selection)
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
  const isStructured = Boolean(activePage.sections && activePage.sections.length > 0)
  const lessonPages = useMemo(
    () => isStructured ? [activePage.content] : paginateLessonMarkdown(activePage.content),
    [activePage.content, isStructured],
  )
  const currentLessonContent = lessonPages[lessonPageIndex] ?? lessonPages[0] ?? activePage.content

  // estimatedPages is plan-aware (topic.planned_pages once the lesson plan
  // exists) — trust it. No phantom "+1" page: a finished topic ends at its
  // last planned page and offers the quiz, instead of inviting the student
  // to mint extra pages for thin topics.
  const totalPlanned  = Math.max(activeTotalPages, activeEstimatedPages)
  const prev          = Math.max(1, activePage.page_number - 1)
  const next          = Math.min(totalPlanned, activePage.page_number + 1)
  const isFirst       = activePage.page_number === 1
  const isLast        = activeTotalPages >= totalPlanned && activePage.page_number >= totalPlanned
  const isFirstScreen = lessonPageIndex === 0
  const isLastScreen  = lessonPageIndex === lessonPages.length - 1
  const pageMarkers = useMemo(
    () => Array.from({ length: Math.min(totalPlanned, 15) }, (_, index) => index + 1),
    [totalPlanned],
  )
  const hasScreenParts = lessonPages.length > 1

  useEffect(() => {
    setLessonPageIndex(0)
  }, [activePage.id])

  // Two-ahead generation prefetch: while the student reads page N, silently
  // generate N+1 and N+2 so rapid "Next → Next" never stalls on generation.
  // Reading takes far longer than generating, so two-ahead stays seamless while
  // keeping wasted generation low. The server hard-caps at the planned page count.
  const prefetchedPagesRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    const candidates = [activePage.page_number + 1, activePage.page_number + 2]
    for (const nextPage of candidates) {
      if (nextPage > Math.min(activeEstimatedPages, 15)) continue
      if (nextPage <= activeTotalPages) continue // already stored
      if (prefetchedPagesRef.current.has(nextPage)) continue
      prefetchedPagesRef.current.add(nextPage)

      fetch(`/api/topics/${encodeURIComponent(topic.id)}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, pageNumber: nextPage }),
      }).then(() => {
        // After generation completes, prefetch the new page into our cache so the
        // client gets it instantly without a second round-trip.
        prefetchPageToCache(nextPage)
      }).catch(() => {
        prefetchedPagesRef.current.delete(nextPage)
      })
    }
  }, [activePage.page_number, topic.id, courseId, activeEstimatedPages, activeTotalPages, prefetchPageToCache])

  return (
    <>
      <div className="study-shell">
        <ThreePanelLayout
        roadmapCollapsed={roadmapCollapsed}
        doubtsExpanded={doubtsExpanded}
        lessonPanelRef={lessonPanelRef}
        left={
          <MiniRoadmap
            topics={topics}
            currentTopicId={topic.id}
            courseId={courseId}
            courseTitle={courseTitle}
            collapsed={roadmapCollapsed}
            onToggle={() => setRoadmapCollapsed((collapsed) => !collapsed)}
            currentPageNumber={activePage.page_number}
            totalPlannedPages={totalPlanned}
            conceptPages={conceptPages}
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

            {quizNudgeState.active && quizNudgeState.topicId ? (
              <QuizNudgeBanner
                topicTitle={quizNudgeState.topicTitle ?? 'that topic'}
                quizHref={`/quiz/${encodeURIComponent(quizNudgeState.topicId)}?mode=checkpoint`}
                onDismiss={quizNudgeState.dismiss}
              />
            ) : null}

            {reviewGaps.length > 0 && activePage.page_number === 1 && lessonPageIndex === 0 ? (
              <div className="lesson-review-reminder" role="note">
                <strong>Reviewing this topic</strong>
                <p>Your last quiz flagged gaps in: {reviewGaps.join(', ')}. Keep those in mind as you read.</p>
              </div>
            ) : null}

            <LessonPage
              page={activePage}
              topicTitle={topic.title}
              content={currentLessonContent}
              screenPage={lessonPageIndex + 1}
              screenPageCount={lessonPages.length}
              globalPageNumber={activeGlobalPageNumber}
              globalPageTotal={globalPageTotal}
              sectionOverrides={sectionOverrides}
              onRestoreSection={restoreSection}
            >
              <LessonFeedback
                courseId={courseId}
                topicId={topic.id}
                pageNumber={activePage.page_number}
                onReexplain={regeneratePage}
                isRegenerating={isRegenerating}
              />
              {isLast && isLastScreen && !quizBannerDismissed ? (
                <QuizInviteBanner
                  topicTitle={topic.title}
                  quizHref={`/quiz/${encodeURIComponent(topic.id)}?mode=checkpoint`}
                  onDismiss={() => setQuizBannerDismissed(true)}
                />
              ) : null}
            </LessonPage>
            {isPageChanging ? (
              <div className="lesson-page-transition" role="status" aria-live="polite">
                <span className="loading-wheel" aria-hidden="true" />
                <span>Turning the page…</span>
              </div>
            ) : null}
            {pageChangeError ? (
              <div className="lesson-page-transition is-error" role="alert">
                <span>{pageChangeError}</span>
              </div>
            ) : null}
            <LessonConceptNavigator
              courseId={courseId}
              topicId={topic.id}
              currentPageNumber={activePage.page_number}
              pages={conceptPages}
            />
            <LessonSelectionToolbar
              topicId={topic.id}
              courseId={courseId}
              topicTitle={topic.title}
              prepareTransform={prepareInlineTransform}
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
                <button
                  className="lesson-nav-btn"
                  type="button"
                  onClick={() => handleNavToPage(prev)}
                  disabled={isPageChanging}
                >
                  Prev
                </button>
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
                  Page {activePage.page_number} of {totalPlanned}
                </span>
                <div className="lesson-page-dots" aria-hidden="true">
                  {pageMarkers.map((pageNumber) => (
                    <span
                      className={[
                        pageNumber === activePage.page_number ? 'active' : '',
                        pageNumber <= activeTotalPages ? 'generated' : 'planned',
                      ].filter(Boolean).join(' ')}
                      key={`${topic.id}-page-${pageNumber}`}
                    />
                  ))}
                </div>
                {hasScreenParts ? (
                  <span className="lesson-page-context">
                    Course page {activeGlobalPageNumber} - Part {lessonPageIndex + 1} of {lessonPages.length}
                  </span>
                ) : (
                  <span className="lesson-page-context">
                    Course page {activeGlobalPageNumber}
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
                ) : isLast && nextTopic && quizNudgeState.active ? (
                  <button
                    className="lesson-nav-btn lesson-nav-next is-blocked"
                    type="button"
                    disabled
                    title={`Take the quiz above to unlock ${nextTopic.title}`}
                  >
                    Quiz required
                  </button>
                ) : isLast ? (
                  <Link
                    className="lesson-nav-btn lesson-nav-next"
                    href={nextTopic ? `/learn/${courseId}/${encodeURIComponent(nextTopic.id)}` : `/course/${courseId}`}
                    title={nextTopic ? `Go to ${nextTopic.title}` : 'Return to Atlas'}
                    prefetch={false}
                  >
                    {nextTopic ? 'Next topic' : 'Atlas'}
                  </Link>
                ) : (
                  <button
                    className="lesson-nav-btn lesson-nav-next"
                    type="button"
                    onClick={() => handleNavToPage(next)}
                    disabled={isPageChanging}
                  >
                    Next
                  </button>
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
            pageNumber={activePage.page_number}
            globalPageNumber={activeGlobalPageNumber}
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
        {recall.rest ? <RecallBreakCountdown rest={recall.rest} onSkipRest={recall.skipRestToReview} /> : null}
        {recall.overlay ? (
          <RecallBreakOverlay
            content={recall.overlay}
            onComplete={recall.completeBreak}
            onTag={recall.tagReminder}
            onDismiss={recall.dismissOverlay}
          />
        ) : null}
        <BottomNav courseId={courseId} />
      </div>
      {/* Keep the printable tree outside study-shell: print CSS hides the app shell. */}
      <LessonPdfDocument
        entries={pdfEntries}
        currentPageId={activePage.id}
        currentPageOverrides={sectionOverrides}
        globalPageTotal={pdfGlobalPageTotal}
      />
    </>
  )
}
