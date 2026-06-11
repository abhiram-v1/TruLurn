'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CurriculumPreview } from '@/components/setup/CurriculumPreview'

const REAL_STAGES = [
  {
    id: 'validating_input',
    label: 'Validating learning goals',
    status: 'Reviewing your course topic and goals...',
    glyph: 'search',
  },
  {
    id: 'extracting_sources',
    label: 'Analyzing source documents',
    status: 'Learning how your material teaches and inferring its curriculum...',
    glyph: 'papers',
  },
  {
    id: 'researching_curriculum',
    label: 'Researching topic curriculum',
    status: 'Comparing reference materials and educational resources...',
    glyph: 'search',
  },
  {
    id: 'building_curriculum',
    label: 'Designing course curriculum',
    status: 'Generating branch structures, topics, and milestones...',
    glyph: 'papers',
  },
  {
    id: 'building_atlas',
    label: 'Building Atlas map',
    status: 'Creating concept nodes and structural layouts...',
    glyph: 'nodes',
  },
  {
    id: 'building_traccia',
    label: 'Building Traccia sequence',
    status: 'Ordering topics so each concept builds on the last...',
    glyph: 'nodes',
  },
  {
    id: 'connecting_prerequisites',
    label: 'Connecting prerequisites',
    status: 'Linking concept nodes that depend on one another...',
    glyph: 'book',
  },
  {
    id: 'persisting_course',
    label: 'Persisting course data',
    status: 'Storing roadmap structure and outlines...',
    glyph: 'finished',
  },
  {
    id: 'preparing_workspace',
    label: 'Preparing workspace',
    status: 'Setting up your customized study path...',
    glyph: 'finished',
  },
  {
    id: 'completed',
    label: 'Completed',
    status: 'Your Atlas is ready!',
    glyph: 'finished',
  },
] as const

const QUOTES = [
  'Good courses are designed, not dumped.',
  'Finding the ideas experts consistently consider essential.',
  'Giving every concept a reason to exist.',
  'Building the path before writing the pages.',
  'Keeping the fundamentals useful, not endless.',
  'Connecting ideas so they are easier to remember.',
  'Your learning path is taking shape.',
]

type GlyphName = typeof REAL_STAGES[number]['glyph']

function GenerationGlyph({ name, animate = true }: { name: GlyphName; animate?: boolean }) {
  return (
    <div className={animate ? 'course-gen-glyph-breathe' : ''} aria-hidden="true">
      <svg
        className="course-gen-glyph"
        key={name}
        viewBox="0 0 120 120"
        role="presentation"
      >
        {name === 'search' ? (
          <>
            <circle cx="52" cy="52" r="27" />
            <line x1="71" y1="71" x2="92" y2="92" />
          </>
        ) : null}
        {name === 'papers' ? (
          <>
            <path d="M34 46 H78 V96 H34 Z" />
            <path d="M42 38 H86 V88" />
            <line x1="44" y1="62" x2="68" y2="62" />
            <line x1="44" y1="74" x2="68" y2="74" />
          </>
        ) : null}
        {name === 'nodes' ? (
          <>
            <line x1="38" y1="40" x2="80" y2="34" />
            <line x1="38" y1="40" x2="56" y2="74" />
            <line x1="80" y1="34" x2="56" y2="74" />
            <line x1="56" y1="74" x2="88" y2="84" />
            <circle cx="38" cy="40" r="7" />
            <circle cx="80" cy="34" r="7" />
            <circle cx="56" cy="74" r="7" />
            <circle cx="88" cy="84" r="6" />
          </>
        ) : null}
        {name === 'book' ? (
          <>
            <path d="M60 40 C50 32 36 32 28 36 V88 C36 84 50 84 60 90" />
            <path d="M60 40 C70 32 84 32 92 36 V88 C84 84 70 84 60 90" />
            <line x1="60" y1="40" x2="60" y2="90" />
          </>
        ) : null}
        {name === 'finished' ? (
          <>
            <path d="M36 34 H82 a6 6 0 0 1 6 6 V92 H42 a6 6 0 0 1 -6 -6 Z" />
            <path d="M36 34 a6 6 0 0 0 -6 6 V86 a6 6 0 0 1 6 -6" />
            <path className="course-gen-glyph-fill" d="M58 34 H72 V62 L65 54 L58 62 Z" />
          </>
        ) : null}
      </svg>
    </div>
  )
}

export function GeneratingOverlay({
  jobId,
  onCancel,
  onRetry,
}: {
  jobId: string
  onCancel: () => void
  onRetry: () => void
}) {
  const [job, setJob] = useState<any>(null)
  const [elapsed, setElapsed] = useState(0)
  const [quoteIndex, setQuoteIndex] = useState(0)
  const [quoteVisible, setQuoteVisible] = useState(true)
  // Bumped after the user approves the curriculum, to re-open the SSE stream and
  // let the worker resume from the curriculum-preview gate.
  const [reconnectNonce, setReconnectNonce] = useState(0)
  // Tracks whether we're paused at the curriculum gate, so the connection's
  // close/onerror does not spin up a redundant polling loop while the user edits.
  const awaitingRef = useRef(false)

  // Fetch / Connect SSE
  useEffect(() => {
    let eventSource: EventSource | null = null
    let pollInterval: NodeJS.Timeout | null = null
    awaitingRef.current = false

    // Fetch initial state first
    fetch(`/api/generation-jobs/${jobId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && !data.error) {
          setJob(data)
          if (data.status === 'awaiting_approval') awaitingRef.current = true
        }
      })
      .catch((err) => console.error('Error fetching initial job status:', err))

    function connect() {
      eventSource = new EventSource(`/api/generation-jobs/${jobId}/events`)

      eventSource.addEventListener('update', (e) => {
        try {
          const updatedJob = JSON.parse(e.data)
          setJob(updatedJob)
          if (updatedJob.status === 'completed') {
            eventSource?.close()
            window.setTimeout(() => {
              window.location.href = `/course/${updatedJob.course_id}`
            }, 1000)
          } else if (updatedJob.status === 'failed') {
            eventSource?.close()
          } else if (updatedJob.status === 'awaiting_approval') {
            // Paused for review — close the stream and wait for the user to approve.
            awaitingRef.current = true
            eventSource?.close()
            if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
          }
        } catch (err) {
          console.error('Error parsing SSE update:', err)
        }
      })

      eventSource.onerror = () => {
        eventSource?.close()
        // Don't poll while paused at the curriculum gate — there's nothing to advance.
        if (awaitingRef.current) return
        // Start polling fallback
        if (!pollInterval) {
          pollInterval = setInterval(async () => {
            try {
              const res = await fetch(`/api/generation-jobs/${jobId}`)
              if (res.ok) {
                const latestJob = await res.json()
                setJob(latestJob)
                if (latestJob.status === 'completed') {
                  clearInterval(pollInterval!)
                  window.setTimeout(() => {
                    window.location.href = `/course/${latestJob.course_id}`
                  }, 1000)
                } else if (latestJob.status === 'failed') {
                  clearInterval(pollInterval!)
                } else if (latestJob.status === 'awaiting_approval') {
                  awaitingRef.current = true
                  clearInterval(pollInterval!)
                  pollInterval = null
                }
              }
            } catch (err) {
              console.error('Fallback polling failed:', err)
            }
          }, 2500)
        }
      }
    }

    connect()

    return () => {
      eventSource?.close()
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [jobId, reconnectNonce])

  // Elapsed timer
  useEffect(() => {
    if (job?.status === 'completed' || job?.status === 'failed') return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [job?.status])

  // Quote rotator
  useEffect(() => {
    if (job?.status === 'completed' || job?.status === 'failed') return
    const timer = window.setInterval(() => {
      setQuoteVisible(false)
      window.setTimeout(() => {
        setQuoteIndex((index) => (index + 1) % QUOTES.length)
        setQuoteVisible(true)
      }, 450)
    }, 6200)
    return () => window.clearInterval(timer)
  }, [job?.status])

  // Compute visible stages dynamically
  const visibleStages = useMemo(() => {
    return REAL_STAGES.filter((stage) => {
      if (job?.input?.mode === 'source_grounded' && stage.id === 'researching_curriculum') {
        return false
      }
      if (job?.input?.mode !== 'source_grounded' && stage.id === 'extracting_sources') {
        return false
      }
      return true
    })
  }, [job?.input?.mode])

  // Locate the active stage in visible list
  const activeStageIndex = useMemo(() => {
    if (!job) return 0
    const idx = visibleStages.findIndex((s) => s.id === job.stage)
    return idx >= 0 ? idx : 0
  }, [job, visibleStages])

  if (!job) {
    return (
      <div className="course-gen-overlay" role="status" aria-live="polite">
        <header className="course-gen-chrome">
          <div className="course-gen-brand">
            <span className="course-gen-brand-mark">T</span>
            <span>TruLurn</span>
          </div>
          <span className="course-gen-running-label">Connecting...</span>
        </header>
        <main className="course-gen-stage">
          <section className="course-gen-center">
            <p className="course-gen-status">Establishing connection to course architect...</p>
          </section>
        </main>
      </div>
    )
  }

  // Curriculum review gate — show the editor instead of the progress spinner.
  if (job.status === 'awaiting_approval' && job.curriculum) {
    return (
      <div className="course-gen-overlay course-gen-overlay--review" role="dialog" aria-label="Review curriculum">
        <header className="course-gen-chrome">
          <div className="course-gen-brand">
            <span className="course-gen-brand-mark">T</span>
            <span>TruLurn</span>
          </div>
          <span className="course-gen-running-label">Review curriculum</span>
        </header>
        <main className="course-gen-stage course-gen-stage--review">
          <CurriculumPreview
            jobId={jobId}
            curriculum={job.curriculum}
            onApproved={() => {
              awaitingRef.current = false
              setJob((prev: any) => ({ ...prev, status: 'running', stage: 'building_atlas' }))
              setReconnectNonce((n) => n + 1)
            }}
          />
        </main>
      </div>
    )
  }

  const complete = job.status === 'completed'
  const failed = job.status === 'failed'
  const activePhase = visibleStages[activeStageIndex] || visibleStages[0]

  return (
    <div
      className={`course-gen-overlay${complete ? ' is-complete' : ''}${failed ? ' is-failed' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={complete ? 'Course generated' : failed ? 'Generation failed' : 'Generating course'}
    >
      <header className="course-gen-chrome">
        <div className="course-gen-brand">
          <span className="course-gen-brand-mark">T</span>
          <span>TruLurn</span>
        </div>
        <span className="course-gen-running-label">
          {complete ? 'Ready' : failed ? 'Generation failed' : 'Course generation'}
        </span>
      </header>

      <main className="course-gen-stage">
        <section className="course-gen-center">
          <div className="course-gen-icon-wrap">
            <GenerationGlyph
              name={complete ? 'finished' : activePhase.glyph}
              animate={job.status === 'running' || job.status === 'queued'}
            />
          </div>

          <h1>
            {complete
              ? 'Your Atlas is ready.'
              : failed
              ? 'Generation failed'
              : 'Building your course'}
          </h1>

          <p className="course-gen-status">
            {complete
              ? 'Opening your new course workspace...'
              : failed
              ? `Failed during: ${activePhase.label}`
              : job.message || activePhase.status}
          </p>

          {!failed && (
            <div className="course-gen-markers" aria-hidden="true">
              {visibleStages.map((stage) => {
                const isDone = job.completed_stages?.includes(stage.id) || complete
                const isActive = job.stage === stage.id && !complete
                return (
                  <span
                    key={stage.id}
                    className={[
                      'course-gen-marker',
                      isDone ? 'is-done' : '',
                      isActive ? 'is-active' : '',
                    ].filter(Boolean).join(' ')}
                  />
                )
              })}
            </div>
          )}

          {failed ? (
            <div className="course-gen-failed-container">
              <p className="course-gen-error-message">
                {job.error || 'An unexpected error occurred during course generation.'}
              </p>
              <div className="course-gen-failed-actions">
                <button type="button" className="button" onClick={onRetry}>
                  Retry
                </button>
                <button type="button" className="button-subtle" onClick={onCancel}>
                  Return to setup
                </button>
              </div>
            </div>
          ) : (
            <p className="course-gen-elapsed">
              {complete
                ? 'Course stored successfully'
                : `Working for ${elapsed} ${elapsed === 1 ? 'second' : 'seconds'}`}
            </p>
          )}

          {!complete && !failed && (
            <p className="course-gen-quote" style={{ opacity: quoteVisible ? 1 : 0 }}>
              “{QUOTES[quoteIndex]}”
            </p>
          )}
        </section>

        {!failed && (
          <aside className="course-gen-timeline" aria-label="Course generation activity">
            <p className="course-gen-timeline-label">Activity</p>
            {job.completed_stages?.length > 0 && !complete ? (
              <p className="course-gen-mobile-summary">
                {job.completed_stages.length}{' '}
                {job.completed_stages.length === 1 ? 'step' : 'steps'} completed
              </p>
            ) : null}
            <div className="course-gen-phase-list">
              {visibleStages.map((stage, index) => {
                const isDone = job.completed_stages?.includes(stage.id) || complete
                const isActive = job.stage === stage.id && !complete
                return (
                  <div
                    className={[
                      'course-gen-phase',
                      isDone ? 'is-done' : '',
                      isActive ? 'is-active' : '',
                      index < activeStageIndex || index > activeStageIndex + 2
                        ? 'is-mobile-hidden'
                        : '',
                    ].filter(Boolean).join(' ')}
                    key={stage.id}
                  >
                    <span className="course-gen-phase-bullet" />
                    <span>{stage.label}</span>
                  </div>
                )
              })}
            </div>
          </aside>
        )}
      </main>
    </div>
  )
}
