'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import type { EvaluationResult, QuizQuestion } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  apply:      'Apply',
  spot_error: 'Spot the error',
  explain:    'Explain',
  mcq:        'Multiple choice',
  true_false: 'True / False',
  code:       'Code answer',
}

const LEVEL_NAMES: Record<number, string> = {
  1: 'Recognition',
  2: 'Mechanical',
  3: 'Conceptual',
  4: 'Transfer',
  5: 'Intuitive',
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

// ── Input renderers ───────────────────────────────────────────────────────────

function McqInput({
  question,
  value,
  onChange,
}: {
  question: QuizQuestion
  value: string
  onChange: (v: string) => void
}) {
  const options = question.options ?? []
  return (
    <div className="quiz-options" role="radiogroup">
      {options.map((opt, i) => (
        <label
          key={i}
          className={`quiz-option${value === opt ? ' selected' : ''}`}
        >
          <input
            type="radio"
            name={question.id}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          <span className="quiz-option-letter">{OPTION_LETTERS[i]}</span>
          <span>{opt}</span>
        </label>
      ))}
    </div>
  )
}

function TrueFalseInput({
  questionId,
  value,
  onChange,
}: {
  questionId: string
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
  questionId,
  value,
  onChange,
}: {
  questionId: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="quiz-code-shell">
      <div className="quiz-code-toolbar">
        <span>Code answer</span>
        <span>Tab inserts spaces</span>
      </div>
      <textarea
        aria-label={`Code answer for ${questionId}`}
        className="quiz-code-input"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={`// Write your solution here\nfunction solve(input) {\n  \n}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return
          e.preventDefault()
          const target = e.currentTarget
          const start = target.selectionStart
          const end = target.selectionEnd
          const next = `${value.slice(0, start)}  ${value.slice(end)}`
          onChange(next)
          requestAnimationFrame(() => {
            target.selectionStart = start + 2
            target.selectionEnd = start + 2
          })
        }}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function QuizSession({
  topicId,
  topicTitle,
  questions,
  courseId,
}: {
  topicId: string
  topicTitle: string
  questions: QuizQuestion[]
  courseId: string
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [evaluations, setEvaluations] = useState<Record<string, EvaluationResult> | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/quiz/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, topicId, answers }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Evaluation failed.')
      setEvaluations(data.evaluations)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Evaluation failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const allResults = evaluations ? Object.values(evaluations) : []
  const passCount = allResults.filter((e) => e.passed).length
  const passed = allResults.length > 0 && allResults.every((e) => e.passed)

  return (
    <div className="quiz-stack">
      {!evaluations ? (
        <form className="quiz-stack" onSubmit={submit}>
          {questions.map((question, index) => {
            const answer = answers[question.id] ?? ''
            const isCode = question.type === 'code'
            const isDescriptive = question.type !== 'mcq' && question.type !== 'true_false' && !isCode

            return (
              <div className="question-block" key={question.id}>
                <div className="question-meta">
                  Q{index + 1} · {TYPE_LABELS[question.type] ?? question.type.replace('_', ' ')}
                </div>
                <p className="question-text">{question.question}</p>

                {question.type === 'mcq' && (
                  <McqInput
                    question={question}
                    value={answer}
                    onChange={(v) => setAnswer(question.id, v)}
                  />
                )}

                {question.type === 'true_false' && (
                  <TrueFalseInput
                    questionId={question.id}
                    value={answer}
                    onChange={(v) => setAnswer(question.id, v)}
                  />
                )}

                {isCode && (
                  <CodeAnswerInput
                    questionId={question.id}
                    value={answer}
                    onChange={(v) => setAnswer(question.id, v)}
                  />
                )}

                {isDescriptive && (
                  <textarea
                    aria-label={`Answer to question ${index + 1}`}
                    placeholder="Explain your reasoning clearly."
                    value={answer}
                    onChange={(e) => setAnswer(question.id, e.target.value)}
                  />
                )}
              </div>
            )
          })}

          {submitError && (
            <div
              className="result-banner"
              style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}
            >
              {submitError}
            </div>
          )}

          <button className="button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Evaluating…' : 'Submit answers'}
          </button>
        </form>
      ) : (
        <div className="quiz-stack">
          {/* Overall result */}
          <div className={`result-banner ${passed ? 'result-banner--pass' : 'result-banner--fail'}`}>
            <strong>
              {passed
                ? `Understanding confirmed — ${passCount} of ${questions.length} questions passed.`
                : `${passCount} of ${questions.length} questions passed — not enough to advance.`}
            </strong>
            <p style={{ marginTop: 6, fontWeight: 400 }}>
              {passed
                ? 'The next topic will unlock.'
                : 'Review the gaps below, then retake.'}
            </p>
          </div>

          {/* Per-question results */}
          {questions.map((question, index) => {
            const ev = evaluations[question.id]
            if (!ev) return null
            const rawAnswer = answers[question.id] || ''
            const displayAnswer =
              question.type === 'true_false'
                ? rawAnswer.charAt(0).toUpperCase() + rawAnswer.slice(1)
                : rawAnswer

            return (
              <div
                className={`result-block ${ev.passed ? 'result-block--pass' : 'result-block--fail'}`}
                key={question.id}
              >
                <div className="result-block-header">
                  <span className="question-meta">
                    Q{index + 1} · {TYPE_LABELS[question.type] ?? question.type}
                  </span>
                  <span className={`quiz-level-badge quiz-level-badge--${ev.passed ? 'pass' : 'fail'}`}>
                    {LEVEL_NAMES[ev.level] ?? `Level ${ev.level}`}
                    {ev.false_confidence ? ' · ⚠ False confidence detected' : ''}
                  </span>
                </div>

                <p className="question-text">{question.question}</p>

                <div className={`result-answer${question.type === 'code' ? ' result-answer--code' : ''}`}>
                  <span className="result-label">Your answer</span>
                  {question.type === 'code'
                    ? <pre><code>{displayAnswer || 'No answer given.'}</code></pre>
                    : <p>{displayAnswer || <em>No answer given.</em>}</p>}
                </div>

                <div className="result-feedback">
                  <span className="result-label">Feedback</span>
                  <p>{ev.feedback}</p>
                </div>

                {ev.gap && (
                  <div className="result-gap">
                    <span className="result-label">Gap to close</span>
                    <p>{ev.gap}</p>
                  </div>
                )}
              </div>
            )
          })}

          <div className="topbar-actions">
            <Link className="button-subtle" href={`/learn/${courseId}/${topicId}`}>
              Return to lesson
            </Link>
            <button
              className="button-quiet"
              type="button"
              onClick={() => {
                setEvaluations(null)
                setAnswers({})
                setSubmitError(null)
              }}
            >
              Retake quiz
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
