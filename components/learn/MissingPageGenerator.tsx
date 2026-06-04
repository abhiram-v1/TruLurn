'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BottomNav } from '@/components/navigation/BottomNav'

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
  const generationStartedRef = useRef(false)

  const generate = useCallback(async function generate() {
    if (generationStartedRef.current) return
    generationStartedRef.current = true
    setStatus('generating')
    setError(null)

    try {
      const response = await fetch(`/api/topics/${topicId}/pages/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, pageNumber, force }),
      })
      const data = (await response.json()) as { error?: string; redirectTo?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'Lesson generation failed.')
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
