'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { HallucinationWarning } from '@/components/setup/HallucinationWarning'
import { ModeSelector } from '@/components/setup/ModeSelector'
import type { CourseMode } from '@/types'

export function TopicInput() {
  const [mode, setMode] = useState<CourseMode>('ai_teacher')
  const [topic, setTopic] = useState('Machine Learning')
  const [goals, setGoals] = useState('I want to understand the core ideas clearly enough to explain and apply them.')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!isGenerating) return
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(100, current + 10))
    }, 220)

    return () => window.clearInterval(timer)
  }, [isGenerating])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (topic.trim().length < 3) return
    setProgress(10)
    setIsGenerating(true)
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
          <div className="field-note">The more specific you are, the better your roadmap.</div>
        </div>
        <button className="button" type="submit" disabled={isGenerating}>
          Build my curriculum
        </button>
      </form>

      {isGenerating ? (
        <div className="generation-box">
          <div className="course-title">Generating stored roadmap, lesson pages, and quiz pool</div>
          <p className="course-meta">Mock generation for now. This is where the provider-neutral AI layer will connect later.</p>
          <div className="progress-track" aria-label="Generation progress">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          {progress >= 100 ? (
            <div style={{ marginTop: 14 }}>
              <Link className="button" href="/learn/course-ml/linear-regression">
                Enter course
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
