'use client'

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { HiSparkles } from 'react-icons/hi2'
import { GeneratingOverlay } from '@/components/setup/GeneratingOverlay'
import type { RecallBreakMode } from '@/components/setup/RecallBreakSelector'
import type { CourseDepth, CourseMode, KnowledgeLevel, LearningControlMode, LearningPurpose } from '@/types'
import type { TeachingPersonaId } from '@/lib/personas'
import {
  IcBalance, IcBolt, IcBook, IcCheck, IcCheckSm, IcCompass, IcDoc, IcExpand,
  IcEye, IcFlask, IcGem, IcMap, IcRobot, IcRoute, IcSprout, IcSummit, IcTool, IcWarn,
} from '@/components/setup/CurriculumIcons'

type GenerateCourseResponse = {
  jobId?: string
  error?: string
  code?: string
}

type CurriculumPreviewData = {
  title: string
  tagline: string
  modules: number
  lessons: number
  hours: number
  difficulty: number
  outcomes: string[]
  roadmap: string[]
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

// ── Static option tables (values match the generate API + course types) ──────

const SOURCE_OPTIONS: Array<{
  value: CourseMode
  title: string
  copy: string
  Icon: typeof IcDoc
}> = [
  // Source-based first.
  {
    value: 'source_grounded',
    title: 'Your documents',
    copy: 'Build from your notes, books, and PDFs. Every lesson stays traceable to your material.',
    Icon: IcDoc,
  },
  {
    value: 'ai_teacher',
    title: 'AI generated',
    copy: 'A complete path designed for you from model knowledge. Best for learning something new end to end.',
    Icon: IcRobot,
  },
]

const PATH_OPTIONS: Array<{
  value: LearningControlMode
  title: string
  Icon: typeof IcRoute
  points: string[]
  badge?: string
}> = [
  {
    value: 'guided',
    title: 'Guided',
    Icon: IcRoute,
    points: ['Progress opens with completed lessons', 'Quiz evidence unlocks what comes next', 'Best for new or high-stakes subjects'],
  },
  {
    value: 'balanced',
    title: 'Balanced',
    Icon: IcBalance,
    points: ['Structure with room to move', 'Trims basics once you show understanding', 'Recommended for most courses'],
    badge: 'Recommended',
  },
  {
    value: 'open',
    title: 'Open',
    Icon: IcExpand,
    points: ['Jump ahead freely, no fixed order', 'The Atlas remembers what you skip', 'Best when you know the fundamentals'],
  },
]

const CONFIG_ROWS = [
  {
    key: 'depth' as const,
    label: 'Detail level',
    sub: 'How deep each lesson goes',
    opts: [
      { v: 'low', label: 'Overview', Icon: IcEye },
      { v: 'standard', label: 'Standard', Icon: IcBook },
      { v: 'high', label: 'Mastery', Icon: IcGem },
    ],
  },
  {
    key: 'level' as const,
    label: 'Knowledge',
    sub: 'Where you start from',
    opts: [
      { v: 'beginner', label: 'Beginner', Icon: IcSprout },
      { v: 'intermediate', label: 'Intermediate', Icon: IcBolt },
      { v: 'expert', label: 'Expert', Icon: IcSummit },
    ],
  },
  {
    key: 'purpose' as const,
    label: 'Focus',
    sub: 'Why you’re learning',
    opts: [
      { v: 'explorer', label: 'Explorer', Icon: IcCompass },
      { v: 'practitioner', label: 'Practitioner', Icon: IcTool },
      { v: 'researcher', label: 'Researcher', Icon: IcFlask },
    ],
  },
]

const PERSONA_OPTIONS: Array<{ value: TeachingPersonaId; title: string; copy: string; example: string }> = [
  {
    value: 'immersive_builder',
    title: 'Immersive Builder',
    copy: 'Starts from meaning, builds toward precision, and closes with something you can use.',
    example: '"Before we define this, let\'s talk about why the previous approach broke down — and why the fix looks nothing like you\'d expect."',
  },
  {
    value: 'investigator',
    title: 'Investigator',
    copy: 'Inspects anomalies, evidence, tempting explanations, and the mechanism that resolves them.',
    example: '"Here\'s something strange: the most-used technique wasn\'t designed to solve the problem it\'s best known for."',
  },
]

const RECALL_OPTIONS: Array<{ value: RecallBreakMode; title: string; copy: string }> = [
  { value: 'auto', title: 'Adaptive', copy: 'Recall when it helps most' },
  { value: '30m', title: 'Every 30 min', copy: 'A pause each half hour' },
  { value: '60m', title: 'Every 60 min', copy: 'An hourly recall pause' },
  { value: 'off', title: 'Manual only', copy: 'No scheduled prompts' },
]

const RECALL_PRESETS = [5, 10, 15, 20]

type CurriculumIdea = { title: string; category: string; goal: string }

const DEPTH_LABEL: Record<CourseDepth, string> = { low: 'Overview', standard: 'Standard', high: 'Mastery' }
const LEVEL_LABEL: Record<KnowledgeLevel, string> = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' }
const PURPOSE_LABEL: Record<LearningPurpose, string> = { explorer: 'Explorer', practitioner: 'Practitioner', researcher: 'Researcher' }
const PATH_LABEL: Record<LearningControlMode, string> = { guided: 'Guided', balanced: 'Balanced', open: 'Open' }
const PERSONA_LABEL: Record<TeachingPersonaId, string> = { immersive_builder: 'Immersive Builder', investigator: 'Investigator' }
const RECALL_LABEL: Record<RecallBreakMode, string> = { auto: 'Adaptive', '30m': 'Every 30 min', '60m': 'Every 60 min', off: 'Manual only' }

const COURSE_FEEL: Record<string, string> = {
  immersive_builder_low_beginner: 'Lessons open with the "why this exists" before touching the mechanics — so nothing lands without context. At overview depth, each page introduces one idea and moves on. You\'ll build a clean mental map without getting lost in detail.',
  immersive_builder_low_intermediate: 'Lessons ground each concept in meaning before building toward precision. At overview depth, you\'ll revisit ideas you partly know and fill in the connective tissue. A fast, satisfying pass — the bigger picture without the edge cases.',
  immersive_builder_low_expert: 'Lessons lead with the conceptual angle — even for territory you already know. At overview depth, the goal is fast reorientation or surveying an adjacent field. Good for mapping unfamiliar ground quickly.',
  immersive_builder_standard_beginner: 'Lessons open with intuition, build toward definition, and close with something concrete. At standard depth, every page earns each new idea before introducing the next. You\'ll finish each lesson with a real example in hand.',
  immersive_builder_standard_intermediate: 'Lessons start from meaning, not memorization. At standard depth, you\'ll get worked examples and important edge cases without exhaustive detail. The kind of course that makes things click rather than just covers them.',
  immersive_builder_standard_expert: 'Lessons lead with the "why" and move quickly to precision — skipping the hand-holding that slows experts down. At standard depth, the focus is synthesis: how this connects to what you already know.',
  immersive_builder_high_beginner: 'Lessons open with the reason something exists before explaining how it works. At mastery depth for a beginner, each page is thorough — you\'ll build genuine foundations, not surface familiarity. Slower, more deliberate, and worth it.',
  immersive_builder_high_intermediate: 'Lessons build from intuition through to rigorous understanding. At mastery depth, every idea gets its full treatment: worked examples, counterexamples, and the subtleties that usually get glossed over. Real command of the material.',
  immersive_builder_high_expert: 'Lessons start with the conceptual core, then go deep without shortcuts. At mastery depth for an expert, expect long-form pages that handle the hard parts — the proofs, the edge cases, the places where the standard explanation is slightly wrong.',
  investigator_low_beginner: 'Lessons start with a puzzle — something odd or counterintuitive — then resolve it accessibly. At overview depth, the investigation is fast and the resolution is clear. You\'ll learn by having assumptions gently challenged.',
  investigator_low_intermediate: 'Lessons surface an anomaly first, then trace back to the mechanism that explains it. At overview depth, the investigation is brisk — you get the key insight without the full forensic trail. Good for quickly sharpening pattern recognition.',
  investigator_low_expert: 'Lessons open with the edge case or counterexample that breaks the standard model. At overview depth for an expert, you\'ll move fast and land on the precise mechanism. Good for stress-testing mental models across a wide field.',
  investigator_standard_beginner: 'Lessons open with something that seems wrong, then build carefully toward the explanation. At standard depth, each step earns the next — nothing is asked to be accepted without understanding why. You\'ll develop the habit of asking "why does this work?"',
  investigator_standard_intermediate: 'Lessons lead with evidence and tempting explanations before revealing the real mechanism. At standard depth, you\'ll work through real cases, not toy examples. Expect your existing mental models to get tested and refined.',
  investigator_standard_expert: 'Lessons open with a genuine anomaly — the kind that stumps practitioners. At standard depth, you\'ll trace through evidence, discard misleading explanations, and arrive at the precise mechanism. This is how experts deepen mastery.',
  investigator_high_beginner: 'Lessons open with a mystery and don\'t let you skip to the answer. At mastery depth for a beginner, every step of the investigation is explained — why the obvious answer is wrong, what the evidence shows, how the mechanism resolves it. Slow, thorough, and genuinely engaging.',
  investigator_high_intermediate: 'Lessons dig into the full trail before landing on the resolution. At mastery depth, you\'ll see not just what\'s true but why competing explanations fail. For learners who want the real story, not just the summary.',
  investigator_high_expert: 'Lessons open with the hardest version of the problem and don\'t simplify it. At mastery depth for an expert, you\'ll trace the full evidence chain — including dead ends and the precise conditions under which the mechanism holds. Maximum depth, maximum rigor.',
}

function getCourseFeel(persona: TeachingPersonaId, depth: CourseDepth, level: KnowledgeLevel): string {
  return COURSE_FEEL[`${persona}_${depth}_${level}`] ?? ''
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A titled section card — the structural unit of the builder. */
function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="cb-block" aria-label={title}>
      <div className="cb-block-head">
        <span className="cb-block-title">{title}</span>
        <span className="cb-block-hint">{hint}</span>
      </div>
      {children}
    </section>
  )
}

export function TopicInput({ initialJobId = null }: TopicInputProps) {
  const { status } = useSession()
  // Source-based learning is the prioritized default.
  const [mode, setMode] = useState<CourseMode>('source_grounded')
  const [learningControl, setLearningControl] = useState<LearningControlMode>('balanced')
  const [courseDepth, setCourseDepth] = useState<CourseDepth>('standard')
  const [knowledgeLevel, setKnowledgeLevel] = useState<KnowledgeLevel>('intermediate')
  const [learningPurpose, setLearningPurpose] = useState<LearningPurpose>('practitioner')
  // Persist the legacy value for stored-course compatibility. Lesson writing
  // now uses one shared minimal teaching directive.
  const teachingPersona: TeachingPersonaId = 'immersive_builder'
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
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [enhancementError, setEnhancementError] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<CurriculumIdea[]>([])
  const [ideasLoading, setIdeasLoading] = useState(true)
  const [previewData, setPreviewData] = useState<CurriculumPreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [sparksExpanded, setSparksExpanded] = useState(false)

  const goalTooShort = description.trim().length < MIN_GOAL_LENGTH
  const needsSource = mode === 'source_grounded' && (!sourceFiles || sourceFiles.length === 0)
  const cannotGenerate = isGenerating || goalTooShort || needsSource

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
        if (active && ['auto', '30m', '60m', 'off'].includes(String(data?.mode))) {
          setRecallBreakMode(data.mode as RecallBreakMode)
        }
        const duration = Number(data?.durationMinutes)
        if (active && Number.isFinite(duration)) {
          setRecallBreakDuration(Math.min(45, Math.max(5, Math.round(duration))))
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [status])

  // Clean up the reveal animation if the component unmounts mid-stream.
  useEffect(() => () => {
    if (typewriterRef.current) clearInterval(typewriterRef.current)
  }, [])

  // Fresh AI-generated idea sparks each time the builder opens.
  const loadIdeasRef = useRef(false)
  async function loadIdeas() {
    setIdeasLoading(true)
    try {
      const res = await fetch('/api/ai/curriculum-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 6 }),
      })
      const data = await res.json()
      if (Array.isArray(data?.ideas) && data.ideas.length) setIdeas(data.ideas)
    } catch {
      // Leave whatever ideas we already have; the block simply won't refresh.
    } finally {
      setIdeasLoading(false)
    }
  }
  useEffect(() => {
    if (loadIdeasRef.current) return
    loadIdeasRef.current = true
    void loadIdeas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (description.trim().length < MIN_GOAL_LENGTH || isStreaming) return
    let active = true
    const timer = setTimeout(async () => {
      setPreviewLoading(true)
      try {
        const res = await fetch('/api/ai/curriculum-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: description.trim(),
            mode,
            depth: courseDepth,
            level: knowledgeLevel,
            purpose: learningPurpose,
            learningControl,
          }),
        })
        if (!active) return
        const data = await res.json()
        if (active && data?.title) setPreviewData(data as CurriculumPreviewData)
      } catch {}
      if (active) setPreviewLoading(false)
    }, 1400)
    return () => { active = false; clearTimeout(timer) }
  }, [description, mode, courseDepth, knowledgeLevel, learningPurpose, learningControl, isStreaming])

  /** Click an idea spark → drop its ready-structured goal into the box (typed in). */
  function pickIdea(idea: CurriculumIdea) {
    if (isEnhancing || isStreaming) return
    setEnhancementError(null)
    revealEnhancedGoal(idea.goal)
  }

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

  /** Gradually reveal the enhanced goal into the textarea (typewriter effect). */
  function revealEnhancedGoal(enhanced: string) {
    if (typewriterRef.current) clearInterval(typewriterRef.current)
    setIsStreaming(true)
    setDescription('')

    const total = enhanced.length
    const step = Math.max(2, Math.ceil(total / 90))
    let i = 0
    typewriterRef.current = setInterval(() => {
      i += step
      if (i >= total) {
        setDescription(enhanced)
        if (typewriterRef.current) clearInterval(typewriterRef.current)
        typewriterRef.current = null
        setIsStreaming(false)
      } else {
        setDescription(enhanced.slice(0, i))
      }
    }, 16)
  }

  async function enhanceGoal() {
    const base = description.trim()
    if (base.length < 3 || isEnhancing || isStreaming) return
    setIsEnhancing(true)
    setEnhancementError(null)
    try {
      const response = await fetch('/api/ai/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: base }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? 'Could not enhance your learning goal.')
      }
      const enhanced = String(data.enhanced ?? '').trim()
      if (!enhanced) throw new Error('Could not enhance your learning goal.')
      setIsEnhancing(false)
      revealEnhancedGoal(enhanced)
    } catch (caught) {
      setEnhancementError(caught instanceof Error ? caught.message : 'Could not enhance your learning goal.')
      setIsEnhancing(false)
    }
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
      formData.append('teachingPersona', teachingPersona)
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

  const sourceLabel = mode === 'source_grounded' ? 'Your documents' : 'AI generated'
  const levelLabel = LEVEL_LABEL[knowledgeLevel]

  return (
    <>
      <form className="cb-form" onSubmit={submit}>
       <div className="cb-grid">
        <div className="cb-col-main">
        {/* ── Goal ── */}
        <Block title="What do you want to achieve?" hint="Goal">
          <div className={`prompt-textarea-wrapper cb-goal-box${isEnhancing || isStreaming ? ' enhancing' : ''}`}>
            <span className="cb-goal-prefix">I want to…</span>
            <textarea
              id="description"
              rows={3}
              aria-label="What do you want to learn?"
              placeholder="start typing — e.g. build and train my own models from scratch"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              readOnly={isStreaming}
            />
            <button
              type="button"
              className="prompt-enhance-icon-btn"
              disabled={isEnhancing || isStreaming || description.trim().length < 3}
              onClick={enhanceGoal}
              title="Enhance goal"
              aria-label="Enhance goal"
            >
              {isEnhancing || isStreaming ? <span className="spinner-mini" /> : <HiSparkles size={16} />}
            </button>
            {(isEnhancing || isStreaming) && (
              <div className="prompt-enhance-veil" aria-hidden="true">
                <span className="prompt-enhance-bar" />
              </div>
            )}
            <div className="cb-goal-foot">
              <span>{description.trim().length} characters{goalTooShort ? ' · keep going' : ''}</span>
              <span>TruLurn names &amp; structures the course from this</span>
            </div>
          </div>

          {enhancementError && <div className="prompt-enhancer-error">{enhancementError}</div>}

          <div className="cb-inline-sparks">
            <span className="cb-is-label">Try:</span>
            <div className="cb-is-chips">
              {ideasLoading && ideas.length === 0
                ? Array.from({ length: 3 }).map((_, i) => <span key={i} className="cb-spark-chip cb-spark-chip-skel" />)
                : (sparksExpanded ? ideas : ideas.slice(0, 3)).map((idea) => (
                    <button
                      key={idea.title}
                      type="button"
                      className="cb-spark-chip"
                      onClick={() => pickIdea(idea)}
                      disabled={isEnhancing || isStreaming}
                      title={idea.goal}
                    >
                      {idea.title}
                    </button>
                  ))}
              {!ideasLoading && ideas.length > 3 && !sparksExpanded && (
                <button type="button" className="cb-is-more" onClick={() => setSparksExpanded(true)}>
                  {ideas.length - 3} more
                </button>
              )}
              {sparksExpanded && (
                <button type="button" className="cb-is-more" onClick={() => setSparksExpanded(false)}>
                  Less
                </button>
              )}
            </div>
            <button type="button" className="cb-is-refresh" onClick={loadIdeas} disabled={ideasLoading} title="New ideas">
              <HiSparkles size={12} />
            </button>
          </div>
        </Block>

        {/* ── Content source (source-based first) ── */}
        <Block title="Choose content source" hint="Where lessons come from">
          <div className="cb-source-grid">
            {SOURCE_OPTIONS.map(({ value, title, copy, Icon }) => (
              <button
                key={value}
                type="button"
                className={`cb-source-card${mode === value ? ' selected' : ''}`}
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
              >
                <span className="cb-sc-check"><IcCheckSm width={9} height={9} /></span>
                <span className="cb-sc-head">
                  <span className="cb-sc-ic"><Icon /></span>
                  <span className="cb-sc-title">{title}</span>
                </span>
                <span className="cb-sc-copy">{copy}</span>
              </button>
            ))}
          </div>

          {mode === 'source_grounded' ? (
            <div className="cb-source-upload">
              <label
                htmlFor="sources"
                className={`cb-upload${isDraggingFiles ? ' dragging' : ''}${sourceFiles?.length ? ' has-files' : ''}`}
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
                <span className="cb-upload-ic"><IcDoc width={22} height={22} /></span>
                <span className="cb-upload-copy">
                  <strong>
                    {sourceFiles?.length
                      ? `${sourceFiles.length} file${sourceFiles.length === 1 ? '' : 's'} selected`
                      : 'Choose files or drag & drop'}
                  </strong>
                  <span>PDF, Word, PowerPoint, Excel, Markdown, HTML, or plain text</span>
                </span>
              </label>
              {sourceFiles && sourceFiles.length > 0 ? (
                <>
                  <ol className="cb-file-list" aria-label="Selected source order">
                    {Array.from(sourceFiles).map((file, idx) => (
                      <li key={`${file.name}-${idx}`}>
                        <span className="cb-file-num">{idx + 1}</span>
                        <span className="cb-file-name">{file.name}</span>
                        <span className="cb-file-size">{formatFileSize(file.size)}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="cb-source-foot">
                    <span>The numbered order above is treated as the study sequence.</span>
                    <button className="cb-clear-btn" type="button" onClick={clearSources}>Clear selection</button>
                  </div>
                </>
              ) : (
                <p className="cb-source-note">
                  Lessons are generated only from this material — foundations, core concepts, and next
                  steps are organized from what your sources actually cover.
                </p>
              )}
            </div>
          ) : (
            <div className="cb-notice">
              <IcWarn />
              <span>This curriculum is AI-generated from model knowledge. Verify technical facts for professional or high-stakes use.</span>
            </div>
          )}
        </Block>

        {/* ── Progression ── */}
        <Block title="Progression" hint="Course policy">
          <div className="cb-path-grid">
            {PATH_OPTIONS.map(({ value, title, Icon, points, badge }) => (
              <button
                key={value}
                type="button"
                className={`cb-path-card${learningControl === value ? ' selected' : ''}`}
                onClick={() => setLearningControl(value)}
                aria-pressed={learningControl === value}
              >
                {badge && <span className="cb-pc-badge">{badge}</span>}
                <span className="cb-pc-top"><Icon className="cb-pc-ic" /><span className="cb-pc-title">{title}</span></span>
                <ul className="cb-pc-list">
                  {points.map((pt) => (
                    <li key={pt}><IcCheck width={11} height={11} />{pt}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        </Block>

        {/* ── Configuration ── */}
        <Block title="Course configuration" hint="Shapes every lesson">
          <div className="cb-config">
            {CONFIG_ROWS.map((row) => {
              const value = row.key === 'depth' ? courseDepth : row.key === 'level' ? knowledgeLevel : learningPurpose
              const setValue = (v: string) => {
                if (row.key === 'depth') setCourseDepth(v as CourseDepth)
                else if (row.key === 'level') setKnowledgeLevel(v as KnowledgeLevel)
                else setLearningPurpose(v as LearningPurpose)
              }
              return (
                <div className="cb-config-row" key={row.key}>
                  <div className="cb-cr-label">
                    <span className="cb-cr-k">{row.label}</span>
                    <span className="cb-cr-s">{row.sub}</span>
                  </div>
                  <div className="cb-seg" role="radiogroup" aria-label={row.label}>
                    {row.opts.map(({ v, label, Icon }) => {
                      const on = value === v
                      return (
                        <button
                          key={v}
                          type="button"
                          className={`cb-seg-btn${on ? ' on' : ''}`}
                          role="radio"
                          aria-checked={on}
                          onClick={() => setValue(v)}
                        >
                          <Icon className="cb-seg-ic" width={15} height={15} />{label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Block>

        {/* ── Teaching persona ── */}
        {/* ── Recall breaks ── */}
        <Block title="Recall breaks" hint="Retrieval beats re-reading">
          <div className="cb-recall-grid">
            {RECALL_OPTIONS.map(({ value, title, copy }) => (
              <button
                key={value}
                type="button"
                className={`cb-recall-card${recallBreakMode === value ? ' selected' : ''}`}
                onClick={() => setRecallBreakMode(value)}
                aria-pressed={recallBreakMode === value}
              >
                <span className="cb-recall-title">{title}</span>
                <span className="cb-recall-copy">{copy}</span>
              </button>
            ))}
          </div>
          {recallBreakMode !== 'off' && (
            <div className="cb-recall-duration">
              <span className="cb-recall-dur-label">Break length</span>
              <div className="cb-recall-presets">
                {RECALL_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={recallBreakDuration === minutes ? 'selected' : ''}
                    onClick={() => setRecallBreakDuration(minutes)}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
            </div>
          )}
        </Block>

        </div>{/* /cb-col-main */}

        <aside className="cb-aside">
          {/* ── AI course preview ── */}
          <div className="cb-aside-card cb-pv-card">
            <div className="cb-pv-header">
              <span className={`cb-pv-live${previewLoading ? ' loading' : ''}`}>
                <span className="cb-pv-dot" />
                {previewLoading ? 'Generating…' : previewData ? 'Live' : 'Preview'}
              </span>
              <span className="cb-pv-label">Course preview</span>
            </div>
            {previewData ? (
              <>
                <div className="cb-pv-title">{previewData.title}</div>
                <p className="cb-pv-tagline">{previewData.tagline}</p>
                <div className="cb-pv-stats">
                  <div className="cb-pv-stat"><b>{previewData.modules}</b><span>Modules</span></div>
                  <div className="cb-pv-stat"><b>{previewData.lessons}</b><span>Lessons</span></div>
                  <div className="cb-pv-stat"><b>{previewData.hours}h</b><span>Est. time</span></div>
                </div>
                {previewData.outcomes.length > 0 && (
                  <div className="cb-pv-section">
                    <div className="cb-pv-sec-label">You will be able to</div>
                    <div className="cb-pv-outcomes">
                      {previewData.outcomes.map((o, i) => (
                        <div key={i} className="cb-pv-outcome">
                          <IcCheckSm width={9} height={9} />
                          <span>{o}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {previewData.roadmap.length > 0 && (
                  <div className="cb-pv-section">
                    <div className="cb-pv-sec-label">Roadmap preview</div>
                    <div className="cb-pv-roadmap">
                      {previewData.roadmap.slice(0, 6).map((t, i) => (
                        <div key={i} className="cb-pv-rm">
                          <span className="cb-pv-rm-num">{i + 1}</span>
                          <span className="cb-pv-rm-title">{t}</span>
                        </div>
                      ))}
                      {previewData.roadmap.length > 6 && (
                        <div className="cb-pv-rm-more">+ {previewData.roadmap.length - 6} more topics</div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : previewLoading ? (
              <div className="cb-pv-skeleton">
                <div className="cb-pv-sk-title" />
                <div className="cb-pv-sk-tag" />
                <div className="cb-pv-sk-stats" />
                <div className="cb-pv-sk-line" />
                <div className="cb-pv-sk-line" style={{ width: '80%' }} />
                <div className="cb-pv-sk-line" style={{ width: '90%' }} />
                <div className="cb-pv-sk-line" style={{ width: '70%' }} />
              </div>
            ) : (
              <p className="cb-pv-hint">Type your learning goal to see an AI-generated course preview here.</p>
            )}
          </div>

          {/* ── Settings blueprint ── */}
          <div className="cb-aside-card">
            <div className="cb-aside-title">Your course blueprint</div>
            <p className="cb-aside-lead">Lessons teach directly with precise definitions, clear intuition, concrete examples, and compact memory summaries.</p>
            <dl className="cb-blueprint">
              <div><dt>Source</dt><dd>{sourceLabel}</dd></div>
              <div><dt>Progression</dt><dd>{PATH_LABEL[learningControl]}</dd></div>
              <div><dt>Detail</dt><dd>{DEPTH_LABEL[courseDepth]}</dd></div>
              <div><dt>Knowledge</dt><dd>{levelLabel}</dd></div>
              <div><dt>Focus</dt><dd>{PURPOSE_LABEL[learningPurpose]}</dd></div>
              <div><dt>Teaching</dt><dd>Warm and direct</dd></div>
              <div><dt>Recall</dt><dd>{RECALL_LABEL[recallBreakMode]}</dd></div>
            </dl>
          </div>
        </aside>
       </div>{/* /cb-grid */}

        {/* ── Sticky build bar ── */}
        <div className="cb-build-bar">
          <div className="cb-build-inner">
            <div className="cb-bb-left">
              <span className="cb-bb-ic"><IcMap width={20} height={20} /></span>
              <div className="cb-bb-copy">
                <span className="cb-bb-title">New curriculum</span>
                <span className="cb-bb-meta">{sourceLabel} · {levelLabel} · {learningControl}</span>
              </div>
            </div>
            <div className="cb-bb-right">
              {readinessHint ? <span className="cb-readiness">{readinessHint}</span> : null}
              <label className="cb-review">
                <input
                  type="checkbox"
                  checked={previewCurriculum}
                  onChange={(e) => setPreviewCurriculum(e.target.checked)}
                />
                <span className="cb-review-box"><IcCheckSm width={10} height={10} /></span>
                Review roadmap before building
              </label>
              <button className="cb-build-btn" type="submit" disabled={cannotGenerate}>
                <HiSparkles size={15} />
                {isGenerating ? 'Building…' : 'Build curriculum'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {isGenerating && activeJobId ? (
        <GeneratingOverlay jobId={activeJobId} onCancel={handleCancel} />
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
