'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BottomNav } from '@/components/navigation/BottomNav'

const INITIAL_BATCH_SIZE = 4

async function prefetchBatch(
  topicId: string,
  courseId: string,
  fromPage: number,
  toPage: number,
) {
  for (let p = fromPage; p <= toPage; p++) {
    try {
      const res = await fetch(`/api/topics/${encodeURIComponent(topicId)}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, pageNumber: p }),
      })
      // If this page was skipped by the AI (content_kind=skip), stop generating further
      if (res.ok) {
        const data = await res.json()
        if (data.skipped) break
      }
    } catch {
      break
    }
  }
}

export function MissingPageGenerator({
  courseId,
  topicId,
  topicTitle,
  pageNumber = 1,
  estimatedPages,
  force = false,
}: {
  courseId: string
  topicId: string
  topicTitle: string
  pageNumber?: number
  estimatedPages?: number
  force?: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'generating' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const generationStartedRef = useRef(false)

  const generate = useCallback(async function generate() {
    if (generationStartedRef.current) return
    generationStartedRef.current = true
    setStatus('generating')
    setError(null)

    try {
      const response = await fetch(`/api/topics/${encodeURIComponent(topicId)}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, pageNumber, force }),
      })
      const data = (await response.json()) as { error?: string; redirectTo?: string; skipped?: boolean }

      if (!response.ok) {
        throw new Error(data.error ?? 'Lesson generation failed.')
      }

      // After page 1 generates, silently prefetch the initial batch (pages 2-4)
      // so the user never waits on subsequent pages within the first batch.
      if (pageNumber === 1 && !force && estimatedPages && estimatedPages > 1) {
        const batchEnd = Math.min(estimatedPages, INITIAL_BATCH_SIZE, 15)
        prefetchBatch(topicId, courseId, 2, batchEnd)
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
  }, [courseId, router, topicId, pageNumber, force, estimatedPages])

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
            ? 'Creating the first stored page for this topic. The learning interface will open when it is ready.'
            : `Generating page ${pageNumber}. This takes a few seconds.`}
        </p>
        {error ? <div className="result-banner error-banner">{error}</div> : null}
        <button className="button" type="button" onClick={generate} disabled={status === 'generating'}>
          {status === 'generating' ? 'Generating…' : 'Retry generation'}
        </button>
      </section>
      <BottomNav courseId={courseId} />
    </main>
  )
}
