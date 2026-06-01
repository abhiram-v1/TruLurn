'use client'

import Link from 'next/link'
import type { GraphData, GraphNode } from '@/lib/graph/types'
import { stateLabel, stateColorVar } from './graphUtils'

interface Props {
  node: GraphNode | null
  data: GraphData
  courseId: string
  onSelect: (id: string) => void
  focusMode: boolean
  onToggleFocus: () => void
}

function connectionLabel(strength: string, critical?: boolean) {
  if (critical) return 'priority path'
  if (strength === 'strong') return 'core path'
  if (strength === 'medium') return 'related'
  return 'light link'
}

function depthLabel(value: number) {
  if (value >= 4) return 'Deep'
  if (value <= 2) return 'Introductory'
  return 'Standard'
}

function roleLabel(value: number) {
  if (value >= 3) return 'Foundation'
  if (value === 2) return 'Bridge'
  return 'Support'
}

export function GraphDetailPanel({ node, data, courseId, onSelect, focusMode, onToggleFocus }: Props) {
  if (!node) {
    return (
      <aside className="kg-detail">
        <div className="kg-empty-detail">
          <strong>No concept selected</strong>
          <span>Click a node in the graph to inspect it.</span>
        </div>
      </aside>
    )
  }

  const nodeById = (id: string) => data.nodes.find((n) => n.id === id)
  const incoming = data.edges.filter((e) => e.to === node.id)
  const outgoing = data.edges.filter((e) => e.from === node.id)
  const n = node  // non-null alias for inner functions

  return (
    <aside className="kg-detail">
      <div className="kg-detail-head">
        <div className="kg-detail-kicker">{node.section}</div>
        <h2 className="kg-detail-title">{node.title}</h2>
        <div className="kg-detail-row">
          <span className={`kg-state-pill ${node.state}`}>
            <span className={`kg-pdot ${node.state}`} />
            {stateLabel(node.state)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--kg-muted)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--kg-muted)' }}>Branch: {node.branchTitle}</span>
        </div>
      </div>

      <div className="kg-detail-scroll">
        {/* Misconception warning */}
        {node.misconception && (
          <div className="kg-detail-section">
            <div className="kg-warn-block">
              <strong>Worth revisiting carefully</strong>
              <p>
                The last quiz answer suggests this idea may need a slower pass.
                Review the explanation, then retake the topic quiz when it feels clearer.
              </p>
            </div>
          </div>
        )}

        {/* Learning signal */}
        {node.state !== 'locked' && (
          <div className="kg-detail-section">
            <div className="kg-detail-label">Learning signal</div>
            <div className="kg-mastery-bar">
              <span className="full" style={{ background: stateColorVar(node.state) }} />
            </div>
            <div className="kg-mastery-text">
              <span>Current evidence from lessons and quiz attempts</span>
              <strong>{stateLabel(node.state)}</strong>
            </div>
          </div>
        )}

        {/* Properties grid */}
        <div className="kg-detail-section">
          <div className="kg-detail-label">Learning role</div>
          <div className="kg-detail-meta">
            <div className="kg-meta-item">
              <div className="k">Depth</div>
              <div className="v">{depthLabel(node.difficulty)}</div>
            </div>
            <div className="kg-meta-item">
              <div className="k">Role</div>
              <div className="v">{roleLabel(node.importance)}</div>
            </div>
            <div className="kg-meta-item">
              <div className="k">Builds from</div>
              <div className="v">{incoming.length ? 'Earlier ideas' : 'Starts here'}</div>
            </div>
            <div className="kg-meta-item">
              <div className="k">Leads toward</div>
              <div className="v">{outgoing.length ? 'Later ideas' : 'Review node'}</div>
            </div>
          </div>
        </div>

        {/* Prerequisite list */}
        <div className="kg-detail-section">
          <div className="kg-detail-label">Prerequisites</div>
          {incoming.length === 0 ? (
            <div style={{ color: 'var(--kg-muted)', fontSize: 12 }}>None — foundational topic.</div>
          ) : (
            <div className="kg-dep-list">
              {incoming.map((e, i) => {
                const dep = nodeById(e.from)
                if (!dep) return null
                return (
                  <button
                    key={i}
                    className={`kg-dep-item${e.strength === 'weak' ? ' weak' : ''}`}
                    onClick={() => onSelect(dep.id)}
                  >
                    <span
                      className="kg-branch-dot"
                      style={{ background: stateColorVar(dep.state), width: 8, height: 8 }}
                    />
                    <span>{dep.title}</span>
                    <span className="strength">{connectionLabel(e.strength, e.critical)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Unlocks list */}
        <div className="kg-detail-section">
          <div className="kg-detail-label">Unlocks</div>
          {outgoing.length === 0 ? (
            <div style={{ color: 'var(--kg-muted)', fontSize: 12 }}>Leaf — no downstream concepts.</div>
          ) : (
            <div className="kg-dep-list">
              {outgoing.map((e, i) => {
                const tgt = nodeById(e.to)
                if (!tgt) return null
                return (
                  <button
                    key={i}
                    className={`kg-dep-item${e.strength === 'weak' ? ' weak' : ''}`}
                    onClick={() => onSelect(tgt.id)}
                  >
                    <span
                      className="kg-branch-dot"
                      style={{ background: stateColorVar(tgt.state), width: 8, height: 8 }}
                    />
                    <span>{tgt.title}</span>
                    <span className="strength">{connectionLabel(e.strength, e.critical)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="kg-detail-section">
          <div className="kg-detail-label">Actions</div>
          <div className="kg-next-actions">
            {(n.state === 'unstable' || n.state === 'partial') && (
              <>
                <Link className="kg-next-btn primary" href={`/learn/${courseId}/${encodeURIComponent(n.id)}`}>
                  Review {n.title} <span className="arrow">→</span>
                </Link>
                <Link className="kg-next-btn" href={`/quiz/${encodeURIComponent(n.id)}`}>Targeted quiz</Link>
              </>
            )}
            {n.state === 'active' && (
              <>
                <Link className="kg-next-btn primary" href={`/learn/${courseId}/${encodeURIComponent(n.id)}`}>
                  Continue lesson <span className="arrow">→</span>
                </Link>
                <Link className="kg-next-btn" href={`/quiz/${encodeURIComponent(n.id)}`}>Take topic quiz</Link>
              </>
            )}
            {(n.state === 'mastered' || n.state === 'functional') && (
              <Link className="kg-next-btn" href={`/learn/${courseId}/${encodeURIComponent(n.id)}`}>
                Review for retention
              </Link>
            )}
            {n.state === 'locked' && (
              <>
                <button className="kg-next-btn" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                  Complete prerequisites to unlock
                </button>
                {incoming[0] && (
                  <button className="kg-next-btn" onClick={() => onSelect(incoming[0].from)}>
                    Jump to first prerequisite
                  </button>
                )}
              </>
            )}
            <button className="kg-next-btn" onClick={onToggleFocus}>
              {focusMode ? 'Exit focus mode' : 'Enter focus mode'}
            </button>
          </div>
        </div>

        {/* Tags */}
        <div className="kg-detail-section">
          <div className="kg-detail-label">Tags</div>
          <div className="kg-tag-row">
            <span className="kg-tag">{node.section}</span>
            <span className="kg-tag">{roleLabel(node.importance)}</span>
            <span className="kg-tag">{depthLabel(node.difficulty)}</span>
            <span className="kg-tag">{stateLabel(node.state)}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
