'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BottomNav } from '@/components/navigation/BottomNav'

// Generates a single missing page, then hands control back to the learn route.
// No batch prefetching here: LearnExperience prefetches exactly one page ahead
// while the student reads, which keeps unread (wasted) generations to at most one.

export function MissingPageGenerator({
  courseId,
  topicId,
  topicTitle,
  pageNumber = 1,
  force = false,
}: {
  courseId: string
  topicId: string
  topicTitle: string
  pageNumber?: number
  force?: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'generating' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [failedChecks, setFailedChecks] = useState<string[]>([])
  const generationStartedRef = useRef(false)

  const generate = useCallback(async function generate(approach?: 'concise') {
    if (generationStartedRef.current) return
    generationStartedRef.current = true
    setStatus('generating')
    setError(null)
    setFailedChecks([])

    try {
      const response = await fetch(`/api/topics/${encodeURIComponent(topicId)}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, pageNumber, force, approach }),
      })
      const data = (await response.json()) as {
        error?: string
        redirectTo?: string
        skipped?: boolean
        topicComplete?: boolean
        plannedPages?: number
        code?: string
        lessonQuality?: { issues?: { message: string; severity: string }[] }
      }

      if (!response.ok) {
        if (data.code === 'LESSON_QUALITY_REJECTED' && data.lessonQuality?.issues?.length) {
          setFailedChecks(
            data.lessonQuality.issues
              .filter((issue) => issue.severity === 'critical')
              .map((issue) => issue.message),
          )
        }
        throw new Error(data.error ?? 'Lesson generation failed.')
      }

      // The lesson plan says this topic is already fully covered — the requested
      // page doesn't exist by design. Land on the last real page instead.
      if (data.topicComplete) {
        const lastPage = Math.max(1, Number(data.plannedPages ?? 1))
        router.replace(`/learn/${courseId}/${encodeURIComponent(topicId)}?page=${lastPage}`)
        return
      }

      if (data.redirectTo) {
        router.push(data.redirectTo)
      } else {
        router.refresh()
      }
    } catch (caught) {
      generationStartedRef.current = false
      setStatus('failed')
      setError(caught instanceof Error ? caught.message : 'Lesson generation failed.')
    }
  }, [courseId, router, topicId, pageNumber, force])

  useEffect(() => {
    if (status === 'idle' && !generationStartedRef.current) {
      void generate()
    }
  }, [generate, status])

  const isFirstPage = pageNumber === 1

  return (
    <main className="missing-page-shell">
      <section className="missing-page-panel">
        <p className="eyebrow">{force ? 'Repairing lesson page' : isFirstPage ? 'Stored lesson page' : `Page ${pageNumber}`}</p>
        <h1 className="page-heading">{topicTitle}</h1>
        <p className="page-subtitle">
          {status === 'failed'
            ? 'The lesson page could not be created. You can retry without losing the course Atlas.'
            : force
            ? 'This stored page was empty or malformed. TruLurn is regenerating it now.'
            : isFirstPage
            ? 'Planning this topic and writing its first page. The learning interface will open when it is ready.'
            : `Generating page ${pageNumber}. This takes a few seconds.`}
        </p>
        {error ? <div className="result-banner error-banner">{error}</div> : null}
        {failedChecks.length ? (
          <ul className="quality-check-list">
            {failedChecks.map((check, index) => (
              <li key={index}>{check}</li>
            ))}
          </ul>
        ) : null}
        <div className="missing-page-actions">
          <button className="button" type="button" onClick={() => void generate()} disabled={status === 'generating'}>
            {status === 'generating' ? 'Generating…' : 'Retry normally'}
          </button>
          {status === 'failed' ? (
            <button className="button-subtle" type="button" onClick={() => void generate('concise')}>
              Generate concise version
            </button>
          ) : null}
        </div>
      </section>
      <BottomNav courseId={courseId} />
    </main>
  )
}
