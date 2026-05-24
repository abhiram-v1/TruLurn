'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { evaluateMockAnswer, getLevelName } from '@/lib/mock-data'
import type { EvaluationResult, QuizQuestion } from '@/types'

export function QuizSession({
  topicId,
  topicTitle,
  questions,
}: {
  topicId: string
  topicTitle: string
  questions: QuizQuestion[]
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [evaluations, setEvaluations] = useState<Record<string, EvaluationResult> | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = Object.fromEntries(
      questions.map((question, index) => [question.id, evaluateMockAnswer(answers[question.id] ?? '', index)]),
    )
    setEvaluations(result)
  }

  const passed = evaluations ? Object.values(evaluations).every((evaluation) => evaluation.passed) : false

  return (
    <div className="quiz-stack">
      {!evaluations ? (
        <form className="quiz-stack" onSubmit={submit}>
          {questions.map((question, index) => (
            <div className="question-block" key={question.id}>
              <div className="question-meta">
                {index + 1} of {questions.length} / {question.type.replace('_', ' ')}
              </div>
              <p className="question-text">{question.question}</p>
              <textarea
                aria-label={`Answer ${index + 1}`}
                value={answers[question.id] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
              />
              {(answers[question.id] ?? '').length > 0 && (answers[question.id] ?? '').length < 50 ? (
                <div className="field-note">Tell us more. Explain your reasoning.</div>
              ) : null}
            </div>
          ))}
          <button className="button" type="submit">
            Submit answers
          </button>
        </form>
      ) : (
        <div className="quiz-stack">
          <div className="result-banner">
            <strong>{passed ? 'Functional understanding shown.' : 'Progression blocked for now.'}</strong>
            <br />
            {passed
              ? 'The topic can move forward after review.'
              : 'The answers do not yet show enough conceptual understanding.'}
          </div>
          {questions.map((question) => {
            const evaluation = evaluations[question.id]
            return (
              <div className="result-block" key={question.id}>
                <div className="question-meta">{question.type.replace('_', ' ')}</div>
                <p className="question-text">{question.question}</p>
                <p className="course-meta">Your answer: {answers[question.id] || 'No answer given.'}</p>
                <p>{evaluation.feedback}</p>
                <p className="course-meta">Level shown: {getLevelName(evaluation.level)}</p>
                {evaluation.gap ? <p className="course-meta">Gap: {evaluation.gap}</p> : null}
              </div>
            )
          })}
          <div className="topbar-actions">
            <Link className="button-subtle" href={`/learn/course-ml/${topicId}`}>
              Return to lesson
            </Link>
            <button className="button-quiet" type="button" onClick={() => setEvaluations(null)}>
              Retake quiz
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
