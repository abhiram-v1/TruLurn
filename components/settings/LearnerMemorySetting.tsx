'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'

type MemoryItem = {
  id: string
  course_id: string | null
  kind: string
  key: string
  value: unknown
  authority: string
  effective_confidence: number
}

type SkillItem = {
  course_id: string
  skill_key: string
  label: string
  evidence_count: number
  effective_mastery: number
  state: string
}

type MisconceptionItem = {
  course_id: string
  misconception_key: string
  label: string
  description: string
  confidence: number
}

type MemoryResponse = {
  memories: MemoryItem[]
  skills: SkillItem[]
  misconceptions: MisconceptionItem[]
  courseTitles: Record<string, string>
}

function memoryLabel(key: string) {
  if (key === 'teaching.knowledge_level') return 'Preferred knowledge level'
  if (key === 'teaching.source_coverage') return 'Source coverage'
  if (key === 'learner.persona') return 'Learner profile'
  if (key === 'learning.comprehension_support') return 'Observed lesson support'
  if (key.startsWith('teaching.directive.')) return 'Teaching preference'
  return key.replace(/[._-]+/g, ' ')
}

function displayValue(value: unknown) {
  if (typeof value === 'string') return value.replace(/_/g, ' ')
  return JSON.stringify(value)
}

export function LearnerMemorySetting() {
  const { status } = useSession()
  const [data, setData] = useState<MemoryResponse | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (status !== 'authenticated') return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/memory')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load memory.')
      setData(body)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load memory.')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    if (expanded && !data && status === 'authenticated') void load()
  }, [data, expanded, load, status])

  const summary = useMemo(() => {
    if (status !== 'authenticated') return 'Sign in to inspect durable learner memory'
    if (!data) return 'Review what TruLurn remembers and uses for personalization'
    return `${data.memories.length} preferences, ${data.skills.length} assessed skills, ${data.misconceptions.length} active misconceptions`
  }, [data, status])

  async function save(memory: MemoryItem) {
    const value = draft.trim()
    if (!value) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoryId: memory.id, value }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not correct memory.')
      setEditingId(null)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not correct memory.')
      setLoading(false)
    }
  }

  async function remove(memory: MemoryItem) {
    if (!window.confirm(`Forget "${displayValue(memory.value)}"?`)) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/memory?memoryId=${encodeURIComponent(memory.id)}`, {
        method: 'DELETE',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not delete memory.')
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete memory.')
      setLoading(false)
    }
  }

  return (
    <div className="settings-memory">
      <div className="settings-row">
        <span>
          <strong>Learner memory</strong>
          <small>{summary}</small>
        </span>
        <button
          className="button-subtle"
          type="button"
          disabled={status !== 'authenticated'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Close' : 'Review'}
        </button>
      </div>

      {expanded ? (
        <div className="memory-settings-panel">
          {loading && !data ? <p className="memory-empty">Loading learner memory...</p> : null}
          {error ? <p className="memory-error">{error}</p> : null}

          {data?.memories.length ? (
            <section>
              <h3>Preferences and profile</h3>
              <p>Explicit statements outrank behavioral observations. Corrections are preserved in history.</p>
              <div className="memory-record-list">
                {data.memories.map((memory) => (
                  <article className="memory-record" key={memory.id}>
                    <div>
                      <strong>{memoryLabel(memory.key)}</strong>
                      <small>
                        {memory.course_id ? data.courseTitles[memory.course_id] ?? 'Course' : 'All courses'}
                        {' · '}
                        {memory.authority.replace(/_/g, ' ')}
                      </small>
                    </div>
                    {editingId === memory.id ? (
                      <div className="memory-edit">
                        <input
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          aria-label={`Correct ${memoryLabel(memory.key)}`}
                        />
                        <button type="button" disabled={loading} onClick={() => void save(memory)}>Save</button>
                        <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="memory-record-value">
                        <span>{displayValue(memory.value)}</span>
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(memory.id)
                              setDraft(displayValue(memory.value))
                            }}
                          >
                            Correct
                          </button>
                          <button type="button" onClick={() => void remove(memory)}>Forget</button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ) : data ? <p className="memory-empty">No durable preferences have been recorded yet.</p> : null}

          {data?.skills.length ? (
            <section>
              <h3>Assessment-backed skill state</h3>
              <p>Skill strength comes only from evaluated quiz evidence and fades toward uncertainty over time.</p>
              <div className="memory-chip-list">
                {data.skills.slice(0, 12).map((skill) => (
                  <span key={`${skill.course_id}:${skill.skill_key}`}>
                    {skill.label}
                    <small>
                      {data.courseTitles[skill.course_id] ?? 'Course'}
                      {' · '}
                      {skill.state} · {skill.evidence_count} checks
                    </small>
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {data?.misconceptions.length ? (
            <section>
              <h3>Still marked for correction</h3>
              <p>These remain active until later assessment evidence demonstrates correction.</p>
              <div className="memory-record-list">
                {data.misconceptions.map((item) => (
                  <article
                    className="memory-record memory-misconception"
                    key={`${item.course_id}:${item.misconception_key}`}
                  >
                    <div>
                      <strong>{item.label}</strong>
                      <small>
                        {data.courseTitles[item.course_id] ?? 'Course'}
                        {' · '}
                        {Math.round(item.confidence * 100)}% evidence confidence
                      </small>
                    </div>
                    <span>{item.description}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
