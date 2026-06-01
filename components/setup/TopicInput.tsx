'use client'

import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { HallucinationWarning } from '@/components/setup/HallucinationWarning'
import { ModeSelector } from '@/components/setup/ModeSelector'
import { GeneratingOverlay } from '@/components/setup/GeneratingOverlay'
import type { CourseMode } from '@/types'

type GenerateCourseResponse = {
  courseId?: string
  firstTopicId?: string
  redirectTo?: string
  error?: string
}

export function TopicInput() {
  const router = useRouter()
  const { status } = useSession()
  const [mode, setMode] = useState<CourseMode>('ai_teacher')
  const [topic, setTopic] = useState('Machine Learning')
  const [goals, setGoals] = useState('I want to understand the core ideas clearly enough to explain and apply them.')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sourceFiles, setSourceFiles] = useState<FileList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)

  useEffect(() => {
    if (!isGenerating) return
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(92, current + 6))
    }, 600)
    return () => window.clearInterval(timer)
  }, [isGenerating])

  function updateSources(event: ChangeEvent<HTMLInputElement>) {
    setSourceFiles(event.target.files)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (topic.trim().length < 3) return

    setError(null)
    setAuthRequired(false)

    if (status !== 'authenticated') {
      setAuthRequired(true)
      return
    }

    setProgress(10)
    setIsGenerating(true)

    try {
      const formData = new FormData()
      formData.append('topic', topic)
      formData.append('goals', goals)
      formData.append('mode', mode)

      if (sourceFiles) {
        Array.from(sourceFiles).forEach((file) => {
          formData.append('sources', file)
        })
      }

      const response = await fetch('/api/courses/generate', {
        method: 'POST',
        body: formData,
      })
      const data = (await response.json()) as GenerateCourseResponse

      if (!response.ok) {
        throw new Error(data.error ?? 'Course generation failed.')
      }

      if (!data.courseId && !data.redirectTo) {
        throw new Error('Course was generated but no workspace route was returned.')
      }

      setProgress(100)
      router.push(data.redirectTo ?? `/course/${data.courseId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Course generation failed.')
      setProgress(0)
      setIsGenerating(false)
    }
  }

  return (
    <>
      <form className="setup-form" onSubmit={submit}>
        <ModeSelector value={mode} onChange={setMode} />
        {mode === 'ai_teacher' ? <HallucinationWarning /> : null}
        <div className="field">
          <label htmlFor="topic">Topic</label>
          <input
            id="topic"
            minLength={3}
            placeholder="e.g. Machine Learning, React, Constitutional Law"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="goals">Goals</label>
          <textarea
            id="goals"
            placeholder="What do you want to be able to do at the end?"
            value={goals}
            onChange={(event) => setGoals(event.target.value)}
          />
          <div className="field-note">The more specific you are, the better your stored Atlas.</div>
        </div>
        {mode === 'source_grounded' ? (
          <div className="field">
            <label htmlFor="sources">Sources</label>
            <input
              id="sources"
              multiple
              type="file"
              accept=".txt,.md,.markdown,.json,.csv,text/plain,text/markdown,application/json,text/csv"
              onChange={updateSources}
            />
            <div className="field-note">MVP upload reads text, markdown, JSON, and CSV. PDFs need a parser before we trust them.</div>
          </div>
        ) : null}
        <button className="button" type="submit" disabled={isGenerating}>
          {isGenerating ? 'Building course...' : 'Build my curriculum'}
        </button>
      </form>

      {isGenerating ? <GeneratingOverlay progress={progress} /> : null}

      {error ? <div className="result-banner error-banner">{error}</div> : null}

      {authRequired ? (
        <div className="result-banner auth-required-banner">
          <div>
            <div className="course-title">Sign in to save this course</div>
            <p className="course-meta">Generated Atlases, summaries, and progress need an account so each course stays isolated and recoverable.</p>
          </div>
          <div className="auth-required-actions">
            <Link className="button" href="/auth/signin">Sign in</Link>
            <Link className="button-subtle" href="/auth/signin">Sign up</Link>
          </div>
        </div>
      ) : null}
    </>
  )
}
