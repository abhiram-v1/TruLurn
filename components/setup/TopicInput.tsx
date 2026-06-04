'use client'

import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { HallucinationWarning } from '@/components/setup/HallucinationWarning'
import { ModeSelector } from '@/components/setup/ModeSelector'
import { LearningControlSelector } from '@/components/setup/LearningControlSelector'
import { CourseDepthSelector } from '@/components/setup/CourseDepthSelector'
import { GeneratingOverlay } from '@/components/setup/GeneratingOverlay'
import type { CourseDepth, CourseMode, LearningControlMode } from '@/types'

type GenerateCourseResponse = {
  courseId?: string
  firstTopicId?: string
  redirectTo?: string
  error?: string
  code?: string
}

export function TopicInput() {
  const router = useRouter()
  const { status } = useSession()
  const [mode, setMode] = useState<CourseMode>('ai_teacher')
  const [learningControl, setLearningControl] = useState<LearningControlMode>('balanced')
  const [courseDepth, setCourseDepth] = useState<CourseDepth>('standard')
  const [description, setDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sourceFiles, setSourceFiles] = useState<FileList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [topicUnsuitable, setTopicUnsuitable] = useState(false)
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
    if (description.trim().length < 10) return

    setError(null)
    setTopicUnsuitable(false)
    setAuthRequired(false)

    if (status !== 'authenticated') {
      setAuthRequired(true)
      return
    }

    setProgress(10)
    setIsGenerating(true)

    try {
      const formData = new FormData()
      formData.append('goals', description)
      formData.append('mode', mode)
      formData.append('learningControl', learningControl)
      formData.append('courseDepth', courseDepth)

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
        if (data.code === 'TOPIC_UNSUITABLE') {
          setTopicUnsuitable(true)
          setProgress(0)
          setIsGenerating(false)
          return
        }
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
        <div className="field">
          <label htmlFor="description">What do you want to learn?</label>
          <textarea
            id="description"
            rows={4}
            placeholder="e.g. I want to understand machine learning well enough to build and train my own models from scratch."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="field-note">Be specific about what you want to be able to do. The AI will name and structure your course.</div>
        </div>
        <ModeSelector value={mode} onChange={setMode} />
        {mode === 'ai_teacher' ? <HallucinationWarning /> : null}
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
            <div className="field-note">Upload text, markdown, JSON, or CSV files. The AI will build the course from your material.</div>
          </div>
        ) : null}
        <LearningControlSelector value={learningControl} onChange={setLearningControl} />
        <CourseDepthSelector value={courseDepth} onChange={setCourseDepth} />
        <button className="button" type="submit" disabled={isGenerating || description.trim().length < 10}>
          {isGenerating ? 'Building course...' : 'Build my course'}
        </button>
      </form>

      {isGenerating ? <GeneratingOverlay progress={progress} /> : null}

      {topicUnsuitable ? (
        <div className="result-banner unsuitable-banner">
          <strong>Topic not suitable for course creation.</strong>
          <p>
            This topic cannot be structured into a multi-lesson course. Please enter a subject that
            can be taught through multiple lessons — such as programming, mathematics, design,
            business, science, languages, or other professional or creative skills.
          </p>
        </div>
      ) : null}

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
