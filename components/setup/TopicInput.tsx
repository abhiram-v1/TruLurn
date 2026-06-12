'use client'

import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { HallucinationWarning } from '@/components/setup/HallucinationWarning'
import { ModeSelector } from '@/components/setup/ModeSelector'
import { LearningControlSelector } from '@/components/setup/LearningControlSelector'
import { CourseDepthSelector } from '@/components/setup/CourseDepthSelector'
import { KnowledgeLevelSelector } from '@/components/setup/KnowledgeLevelSelector'
import { LearningPurposeSelector } from '@/components/setup/LearningPurposeSelector'
import { TeachingStyleSelector, type TeachingStyleChoice } from '@/components/setup/TeachingStyleSelector'
import { RecallBreakSelector, type RecallBreakMode } from '@/components/setup/RecallBreakSelector'
import { GeneratingOverlay } from '@/components/setup/GeneratingOverlay'
import type { CourseDepth, CourseMode, KnowledgeLevel, LearningControlMode, LearningPurpose } from '@/types'

type GenerateCourseResponse = {
  jobId?: string
  error?: string
  code?: string
}

interface TopicInputProps {
  initialJobId?: string | null
}

const MIN_GOAL_LENGTH = 10

const ACCEPTED_SOURCE_TYPES = [
  '.txt', '.md', '.markdown', '.json', '.csv', '.pdf', '.docx', '.pptx', '.xlsx', '.html', '.epub',
  'text/plain', 'text/markdown', 'application/json', 'text/csv', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',')

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Numbered section card — the structural unit of the setup form. */
function SetupSection({
  step,
  title,
  description,
  children,
}: {
  step: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="setup-section" aria-label={title}>
      <header className="setup-section-head">
        <span className="setup-section-step" aria-hidden="true">{step}</span>
        <div className="setup-section-heading">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="setup-section-body">{children}</div>
    </section>
  )
}

export function TopicInput({ initialJobId = null }: TopicInputProps) {
  const { status } = useSession()
  const [mode, setMode] = useState<CourseMode>('ai_teacher')
  const [learningControl, setLearningControl] = useState<LearningControlMode>('balanced')
  const [courseDepth, setCourseDepth] = useState<CourseDepth>('standard')
  const [knowledgeLevel, setKnowledgeLevel] = useState<KnowledgeLevel>('intermediate')
  const [learningPurpose, setLearningPurpose] = useState<LearningPurpose>('practitioner')
  const [teachingStyle, setTeachingStyle] = useState<TeachingStyleChoice>('auto')
  const [recallBreakMode, setRecallBreakMode] = useState<RecallBreakMode>('auto')
  const [recallBreakDuration, setRecallBreakDuration] = useState(10)
  const [previewCurriculum, setPreviewCurriculum] = useState(true)
  const [description, setDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(initialJobId !== null)
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId)
  const [sourceFiles, setSourceFiles] = useState<FileList | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [topicUnsuitable, setTopicUnsuitable] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const goalTooShort = description.trim().length < MIN_GOAL_LENGTH
  const needsSource = mode === 'source_grounded' && (!sourceFiles || sourceFiles.length === 0)
  const cannotGenerate = isGenerating || goalTooShort || needsSource

  // What is still missing before the course can build — shown next to the submit button.
  const readinessHint = goalTooShort
    ? 'Describe your goal to continue.'
    : needsSource
      ? 'Add at least one source file to continue.'
      : null

  useEffect(() => {
    if (status !== 'authenticated') return
    let active = true
    fetch('/api/settings/recall')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (
          active
          && ['auto', '30m', '60m', 'off'].includes(String(data?.mode))
        ) {
          setRecallBreakMode(data.mode as RecallBreakMode)
        }
        const duration = Number(data?.durationMinutes)
        if (active && Number.isFinite(duration)) {
          setRecallBreakDuration(Math.min(45, Math.max(5, Math.round(duration))))
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [status])

  function updateSources(event: ChangeEvent<HTMLInputElement>) {
    setSourceFiles(event.target.files)
    setError(null)
  }

  function clearSources() {
    setSourceFiles(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSourceDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDraggingFiles(false)
    if (event.dataTransfer.files?.length) {
      setSourceFiles(event.dataTransfer.files)
      setError(null)
    }
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
    if (goalTooShort) return

    setError(null)
    setTopicUnsuitable(false)
    setAuthRequired(false)

    if (status !== 'authenticated') {
      setAuthRequired(true)
      return
    }

    setIsGenerating(true)

    try {
      const recallResponse = await fetch('/api/settings/recall', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: recallBreakMode,
          durationMinutes: recallBreakDuration,
        }),
      })
      if (!recallResponse.ok) {
        const recallData = await recallResponse.json().catch(() => null)
        throw new Error(recallData?.error ?? 'Could not save the recall break schedule.')
      }

      const formData = new FormData()
      formData.append('goals', description)
      formData.append('mode', mode)
      formData.append('learningControl', learningControl)
      formData.append('courseDepth', courseDepth)
      formData.append('knowledgeLevel', knowledgeLevel)
      formData.append('learningPurpose', learningPurpose)
      formData.append('teachingStyle', teachingStyle)
      formData.append('previewCurriculum', String(previewCurriculum))

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
        <SetupSection
          step="01"
          title="Learning goal"
          description="What you want to be able to do when the course is done. The AI names and structures the course from this."
        >
          <div className="setup-field">
            <textarea
              id="description"
              rows={4}
              aria-label="What do you want to learn?"
              placeholder="e.g. I want to understand machine learning well enough to build and train my own models from scratch."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <div className="setup-field-foot">
              <span>Be specific — outcomes beat subjects. &ldquo;Read financial statements confidently&rdquo; builds a better course than &ldquo;finance&rdquo;.</span>
              {description.trim().length > 0 && goalTooShort ? (
                <span className="setup-field-count">Keep going — a sentence is enough</span>
              ) : null}
            </div>
          </div>
        </SetupSection>

        <SetupSection
          step="02"
          title="Course source"
          description="Where the course content comes from."
        >
          <ModeSelector value={mode} onChange={setMode} />
          {mode === 'ai_teacher' ? <HallucinationWarning /> : null}
          {mode === 'source_grounded' ? (
            <div className="setup-field">
              <label
                htmlFor="sources"
                className={`source-dropzone${isDraggingFiles ? ' dragging' : ''}${sourceFiles?.length ? ' has-files' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setIsDraggingFiles(true) }}
                onDragLeave={() => setIsDraggingFiles(false)}
                onDrop={handleSourceDrop}
              >
                <input
                  ref={fileInputRef}
                  id="sources"
                  className="hidden-file-input"
                  multiple
                  type="file"
                  accept={ACCEPTED_SOURCE_TYPES}
                  onChange={updateSources}
                />
                <strong>
                  {sourceFiles?.length
                    ? `${sourceFiles.length} file${sourceFiles.length === 1 ? '' : 's'} selected`
                    : 'Drop files here or click to browse'}
                </strong>
                <span>PDF, Word, PowerPoint, Excel, Markdown, HTML, or plain text</span>
              </label>
              {sourceFiles && sourceFiles.length > 0 ? (
                <>
                  <ol className="source-order-list" aria-label="Selected source order">
                    {Array.from(sourceFiles).map((file, idx) => (
                      <li key={`${file.name}-${idx}`}>
                        <span className="source-order-num">{idx + 1}</span>
                        <span className="source-order-name">{file.name}</span>
                        <span className="source-order-size">{formatFileSize(file.size)}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="setup-field-foot">
                    <span>The numbered order above is treated as the study sequence.</span>
                    <button className="source-clear-btn" type="button" onClick={clearSources}>
                      Clear selection
                    </button>
                  </div>
                </>
              ) : (
                <div className="setup-field-foot">
                  <span>
                    Lessons are generated only from this material — foundations, core concepts, and
                    next steps are organized from what your sources actually cover.
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </SetupSection>

        <SetupSection
          step="03"
          title="Course structure"
          description="How the roadmap is paced and how much ground it covers."
        >
          <LearningControlSelector value={learningControl} onChange={setLearningControl} />
          <CourseDepthSelector value={courseDepth} onChange={setCourseDepth} />
        </SetupSection>

        <SetupSection
          step="04"
          title="Personalization"
          description="How lessons are written for you. TruLurn keeps adapting these as it learns how you study."
        >
          <KnowledgeLevelSelector value={knowledgeLevel} onChange={setKnowledgeLevel} />
          <LearningPurposeSelector value={learningPurpose} onChange={setLearningPurpose} />
          <TeachingStyleSelector value={teachingStyle} onChange={setTeachingStyle} />
        </SetupSection>

        <SetupSection
          step="05"
          title="Study rhythm"
          description="Short retrieval pauses during study sessions — recalling beats re-reading."
        >
          <RecallBreakSelector
            value={recallBreakMode}
            onChange={setRecallBreakMode}
            durationMinutes={recallBreakDuration}
            onDurationChange={setRecallBreakDuration}
          />
        </SetupSection>

        <footer className="setup-footer">
          <label className="setup-review-toggle">
            <input
              type="checkbox"
              checked={previewCurriculum}
              onChange={(e) => setPreviewCurriculum(e.target.checked)}
            />
            <span>
              <strong>Review the curriculum before building</strong>
              Rename, reorder, add, or remove topics before lessons are generated.
            </span>
          </label>
          <div className="setup-submit-group">
            {readinessHint ? <span className="setup-readiness-hint">{readinessHint}</span> : null}
            <button className="button setup-submit" type="submit" disabled={cannotGenerate}>
              {isGenerating ? 'Building course…' : 'Build my course'}
            </button>
          </div>
        </footer>
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
