'use client'

import { ChangeEvent, FormEvent, useState } from 'react'
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
  jobId?: string
  error?: string
  code?: string
}

interface TopicInputProps {
  initialJobId?: string | null
}

export function TopicInput({ initialJobId = null }: TopicInputProps) {
  const router = useRouter()
  const { status } = useSession()
  const [mode, setMode] = useState<CourseMode>('ai_teacher')
  const [learningControl, setLearningControl] = useState<LearningControlMode>('balanced')
  const [courseDepth, setCourseDepth] = useState<CourseDepth>('standard')
  const [description, setDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(initialJobId !== null)
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId)
  const [generationComplete, setGenerationComplete] = useState(false)
  const [sourceFiles, setSourceFiles] = useState<FileList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [topicUnsuitable, setTopicUnsuitable] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const needsSource = mode === 'source_grounded' && (!sourceFiles || sourceFiles.length === 0)
  const cannotGenerate = isGenerating || description.trim().length < 10 || needsSource

  function updateSources(event: ChangeEvent<HTMLInputElement>) {
    setSourceFiles(event.target.files)
    setError(null)
  }

  function handleCancel() {
    setActiveJobId(null)
    setIsGenerating(false)
    window.history.replaceState(null, '', '/setup')
  }

  async function handleRetry() {
    setActiveJobId(null)
    setIsGenerating(false)
    window.history.replaceState(null, '', '/setup')
    await startGeneration()
  }

  async function startGeneration() {
    if (description.trim().length < 10) return

    setError(null)
    setTopicUnsuitable(false)
    setAuthRequired(false)

    if (status !== 'authenticated') {
      setAuthRequired(true)
      return
    }

    setGenerationComplete(false)
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
          setIsGenerating(false)
          return
        }
        throw new Error(data.error ?? 'Course generation failed.')
      }

      if (!data.jobId) {
        throw new Error('Course was generated but no job ID was returned.')
      }

      window.history.replaceState(null, '', `/setup?job=${data.jobId}`)
      setActiveJobId(data.jobId)
      setIsGenerating(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Course generation failed.')
      setGenerationComplete(false)
      setIsGenerating(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await startGeneration()
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
            <label>Sources</label>
            <label htmlFor="sources" className="custom-file-upload">
              <input
                id="sources"
                className="hidden-file-input"
                multiple
                required
                type="file"
                accept=".txt,.md,.markdown,.json,.csv,.pdf,.docx,.pptx,.xlsx,.html,.epub,text/plain,text/markdown,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={updateSources}
              />
              <div className="upload-icon-wrapper">
                <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5h10.5a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <div className="upload-text">
                {sourceFiles?.length ? (
                  <strong>{sourceFiles.length} file{sourceFiles.length === 1 ? '' : 's'} selected</strong>
                ) : (
                  <strong>Choose files to upload</strong>
                )}
                <span>or drag & drop them here</span>
              </div>
            </label>
            {sourceFiles && sourceFiles.length > 0 && (
              <div className="file-pill-list">
                {Array.from(sourceFiles).map((file, idx) => (
                  <span key={idx} className="file-pill">
                    {file.name}
                  </span>
                ))}
              </div>
            )}
            <div className="field-note">
              Upload text, Markdown, PDF, Word, PowerPoint, Excel, or HTML files. The AI will build the course from your material.
            </div>
          </div>
        ) : null}
        <LearningControlSelector value={learningControl} onChange={setLearningControl} />
        <CourseDepthSelector value={courseDepth} onChange={setCourseDepth} />
        <button className="button" type="submit" disabled={cannotGenerate}>
          {isGenerating ? 'Building course...' : 'Build my course'}
        </button>
      </form>

      {isGenerating && activeJobId ? (
        <GeneratingOverlay
          jobId={activeJobId}
          onCancel={handleCancel}
          onRetry={handleRetry}
        />
      ) : null}

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
