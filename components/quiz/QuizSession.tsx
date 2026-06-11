'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { EvaluationResult, ExamMode, ExamTurn, QuestionType } from '@/types'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { MarkdownContent } from '@/components/ui/MarkdownContent'

// Detect the most likely language extension from the topic/course title.
// Defaults to Python for general CS courses.
function detectLanguageExtensions(topicTitle: string) {
  const t = topicTitle.toLowerCase()
  if (/python/.test(t)) return [python()]
  if (/javascript|typescript|react|node|next/.test(t)) return [javascript({ typescript: true })]
  if (/\bjava\b/.test(t)) return [java()]
  if (/c\+\+|cpp/.test(t)) return [cpp()]
  if (/rust/.test(t)) return [rust()]
  if (/sql/.test(t)) return [sql()]
  return [python()]
}

const TYPE_LABELS: Record<QuestionType, string> = {
  apply: 'Apply',
  spot_error: 'Spot the error',
  explain: 'Explain',
  mcq: 'Multiple choice',
  true_false: 'True / False',
  code: 'Code answer',
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

// Strip the "A. " / "B. " prefix the model includes — the component adds its own letter label.
function stripOptionPrefix(text: string) {
  return text.replace(/^[A-D]\.\s*/, '').trim()
}

// Render inline markdown: `code`, **bold**, *italic* — without block-level elements.
// Used for MCQ option text which often contains inline code references.
function InlineMarkdown({ text }: { text: string }) {
  // Split on `code` spans first, then handle bold/italic in plain segments
  const segments = text.split(/(`[^`\n]+`)/)
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
          return <code key={i} className="md-inline-code">{seg.slice(1, -1)}</code>
        }
        // Bold: **text**
        const boldParts = seg.split(/(\*\*[^*]+\*\*)/)
        return (
          <span key={i}>
            {boldParts.map((part, j) => {
              if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                return <strong key={j}>{part.slice(2, -2)}</strong>
              }
              return part
            })}
          </span>
        )
      })}
    </>
  )
}

type ExamSessionPayload = {
  session: {
    id: string
    course_id: string
    topic_id: string
    mode: ExamMode
    status: string
    question_index: number
    min_questions: number
    max_questions: number
    followups_used: number
    max_followups: number
    summary?: {
      passed?: boolean
      overall_level?: number
      passed_count?: number
      total_questions?: number
      strong_concepts?: string[]
      review_concepts?: string[]
      student_summary?: string
      graph_update?: { summary?: string; nextSuggestedTopicId?: string | null } | null
      prerequisite_gap?: { topic_id: string; title: string; reason: string } | null
    } | null
  }
  turn: ExamTurn | null
  turns?: Array<ExamTurn & {
    answer?: string
    rubric?: string | null
    evaluation?: EvaluationResult | null
  }>
}

function McqInput({
  turn,
  value,
  onChange,
}: {
  turn: ExamTurn
  value: string
  onChange: (v: string) => void
}) {
  const options = turn.options ?? []
  return (
    <div className="quiz-options" role="radiogroup">
      {options.map((opt, i) => (
        <label
          key={opt}
          className={`quiz-option${value === opt ? ' selected' : ''}`}
        >
          <input
            type="radio"
            name={turn.id}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          <span className="quiz-option-letter">{OPTION_LETTERS[i] ?? String(i + 1)}</span>
          <span><InlineMarkdown text={stripOptionPrefix(opt)} /></span>
        </label>
      ))}
    </div>
  )
}

function TrueFalseInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="quiz-tf-buttons">
      {(['true', 'false'] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          className={`quiz-tf-btn${value === opt ? ' selected' : ''}`}
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
        >
          {opt === 'true' ? 'True' : 'False'}
        </button>
      ))}
    </div>
  )
}

function CodeAnswerInput({
  value,
  onChange,
  topicTitle,
}: {
  value: string
  onChange: (v: string) => void
  topicTitle: string
}) {
  const extensions = useMemo(() => detectLanguageExtensions(topicTitle), [topicTitle])

  return (
    <div className="quiz-code-shell">
      <div className="quiz-code-toolbar">
        <span>Code answer</span>
        <span>⇥ indent · ⌘Z undo</span>
      </div>
      <CodeMirror
        value={value}
        onChange={onChange}
        theme={oneDark}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          autocompletion: true,
          highlightActiveLine: true,
          tabSize: 4,
        }}
        className="quiz-codemirror"
        minHeight="240px"
        placeholder="# Write your solution here"
      />
    </div>
  )
}

function AnswerInput({
  turn,
  answer,
  setAnswer,
  topicTitle,
}: {
  turn: ExamTurn
  answer: string
  setAnswer: (value: string) => void
  topicTitle: string
}) {
  if (turn.type === 'mcq') {
    return <McqInput turn={turn} value={answer} onChange={setAnswer} />
  }
  if (turn.type === 'true_false') {
    return <TrueFalseInput value={answer} onChange={setAnswer} />
  }
  if (turn.type === 'code') {
    return <CodeAnswerInput value={answer} onChange={setAnswer} topicTitle={topicTitle} />
  }
  return (
    <textarea
      aria-label="Quiz answer"
      placeholder="Explain your reasoning clearly."
      value={answer}
      onChange={(e) => setAnswer(e.target.value)}
    />
  )
}

function ResultView({
  state,
  courseId,
  topicId,
}: {
  state: ExamSessionPayload
  courseId: string
  topicId: string
}) {
  const summary = state.session.summary
  const turns = state.turns ?? []
  const passed = Boolean(summary?.passed)
  const nextTopicId = summary?.graph_update?.nextSuggestedTopicId ?? null
  const prereqGap = summary?.prerequisite_gap ?? null

  return (
    <div className="quiz-stack">
      <div className={`result-banner ${passed ? 'result-banner--pass' : 'result-banner--fail'}`}>
        <strong>{passed ? 'Quiz completed' : 'Review recommended'}</strong>
        <p style={{ marginTop: 6, fontWeight: 400 }}>
          {summary?.student_summary ?? 'Your answers have been evaluated and stored.'}
        </p>
        {summary?.graph_update?.summary && (
          <p style={{ marginTop: 6, fontWeight: 400 }}>{summary.graph_update.summary}</p>
        )}
      </div>

      {prereqGap ? (
        <div className="prereq-gap-card">
          <span className="prereq-gap-label">Likely root cause</span>
          <p className="prereq-gap-text">
            {prereqGap.reason} The real gap looks like it&rsquo;s in an earlier topic:{' '}
            <strong>{prereqGap.title}</strong>.
          </p>
          <Link
            className="button-subtle"
            href={`/learn/${courseId}/${encodeURIComponent(prereqGap.topic_id)}`}
          >
            Revisit {prereqGap.title} first →
          </Link>
        </div>
      ) : null}

      {(summary?.strong_concepts?.length || summary?.review_concepts?.length) ? (
        <div className="question-block">
          {summary.strong_concepts?.length ? (
            <>
              <div className="question-meta">Felt steady</div>
              <p className="question-text">{summary.strong_concepts.join(', ')}</p>
            </>
          ) : null}
          {summary.review_concepts?.length ? (
            <>
              <div className="question-meta" style={{ marginTop: 18 }}>Worth revisiting</div>
              <p className="question-text">{summary.review_concepts.join(', ')}</p>
            </>
          ) : null}
        </div>
      ) : null}

      {turns.map((turn) => (
        <div
          className={`result-block ${turn.evaluation?.passed ? 'result-block--pass' : 'result-block--fail'}`}
          key={turn.id}
        >
          <div className="result-block-header">
            <span className="question-meta">
              Question {turn.turn_index} · {TYPE_LABELS[turn.type]}
              {turn.source === 'followup' ? ' · Follow-up' : ''}
            </span>
          </div>
          <div className="question-text">
            <MarkdownContent className="quiz-question-md">{turn.question}</MarkdownContent>
          </div>
          <div className={`result-answer${turn.type === 'code' ? ' result-answer--code' : ''}`}>
            <span className="result-label">Your answer</span>
            {turn.type === 'code'
              ? <pre><code>{turn.answer || 'No answer given.'}</code></pre>
              : <p>{turn.answer || <em>No answer given.</em>}</p>}
          </div>
          {turn.evaluation && (
            <div className="result-feedback">
              <span className="result-label">Feedback</span>
              <MarkdownContent className="quiz-question-md">{turn.evaluation.feedback}</MarkdownContent>
              {turn.evaluation.gap && (
                <p><strong>Review:</strong> {turn.evaluation.gap}</p>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="topbar-actions">
        <Link className="button-subtle" href={`/learn/${courseId}/${topicId}`}>
          Return to lesson
        </Link>
        {passed && nextTopicId ? (
          <Link className="button" href={`/learn/${courseId}/${encodeURIComponent(nextTopicId)}`}>
            Continue →
          </Link>
        ) : passed ? (
          <Link className="button" href={`/course/${courseId}`}>
            Back to Atlas
          </Link>
        ) : (
          <Link className="button" href={`/learn/${courseId}/${topicId}`}>
            Review lesson
          </Link>
        )}
      </div>
    </div>
  )
}

export function QuizSession({
  topicId,
  topicTitle,
  courseId,
  mode = 'full_topic',
  isReview = false,
}: {
  topicId: string
  topicTitle: string
  courseId: string
  mode?: ExamMode
  isReview?: boolean
}) {
  const [state, setState] = useState<ExamSessionPayload | null>(null)
  const [answer, setAnswer] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function start() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/exams/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, topicId, mode, isReview }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not start quiz.')
        if (alive) {
          setState(data)
          setAnswer('')
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not start quiz.')
      } finally {
        if (alive) setIsLoading(false)
      }
    }
    start()
    return () => {
      alive = false
    }
  }, [courseId, topicId, mode, isReview])

  const turn = state?.turn ?? null
  const progressLabel = useMemo(() => {
    if (!state || !turn) return 'Preparing quiz'
    if (state.session.mode === 'spot_check') return `Spot check · Question ${turn.turn_index}`
    return `Question ${turn.turn_index}${turn.source === 'followup' ? ' · follow-up' : ''}`
  }, [state, turn])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state?.session.id || !turn) return
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/exams/${encodeURIComponent(state.session.id)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: turn.id, answer }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not submit answer.')
      setState(data)
      setAnswer('')
      // Feed the recall-break session tracker — answered questions count toward
      // session activity. Fire-and-forget; never blocks the quiz flow.
      fetch('/api/recall/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, event: 'question_answered', topicId }),
      }).catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit answer.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="quiz-stack">
        <div className="question-block">
          <div className="question-meta">Preparing exam pointer</div>
          <p className="question-text">Building this quiz from your Traccia path and stored lesson pages.</p>
        </div>
      </div>
    )
  }

  if (error && !state) {
    return (
      <div className="quiz-stack">
        <div className="result-banner result-banner--fail">
          <strong>Quiz could not start</strong>
          <p style={{ marginTop: 6, fontWeight: 400 }}>{error}</p>
        </div>
      </div>
    )
  }

  if (state?.session.status === 'completed') {
    return <ResultView state={state} courseId={courseId} topicId={topicId} />
  }

  if (!turn) {
    return (
      <div className="quiz-stack">
        <div className="question-block">
          <div className="question-meta">Scoring final answers</div>
          <p className="question-text">The engine is finishing evaluation. Refresh if this takes longer than a moment.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="quiz-stack">
      <form className="quiz-stack" onSubmit={submit}>
        <div className="question-block">
          <div className="question-meta">
            {progressLabel} · {TYPE_LABELS[turn.type]}
          </div>
          <div className="question-text">
            <MarkdownContent className="quiz-question-md">{turn.question}</MarkdownContent>
          </div>
          <AnswerInput turn={turn} answer={answer} setAnswer={setAnswer} topicTitle={topicTitle} />
        </div>

        {error && (
          <div className="result-banner result-banner--error">
            {error}
          </div>
        )}

        <button className="button" type="submit" disabled={isSubmitting || !answer.trim()}>
          {isSubmitting ? 'Saving answer...' : 'Continue'}
        </button>
      </form>

      <p className="page-subtitle" style={{ marginTop: 4 }}>
        Results stay hidden until the end. Follow-ups appear only when the engine needs a little more evidence.
      </p>
    </div>
  )
}
