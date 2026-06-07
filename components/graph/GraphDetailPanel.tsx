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
        {/* False confidence warning — distinct from general misconception */}
        {node.falseConfidence && (
          <div className="kg-detail-section">
            <div className="kg-warn-block false-confidence">
              <strong>False confidence detected</strong>
              <p>
                Your last quiz showed you were confident but the answers revealed a gap.
                This is harder to fix than simply not knowing — re-read the explanation slowly before retaking.
              </p>
            </div>
          </div>
        )}

        {/* Misconception warning */}
        {node.misconception && !node.falseConfidence && (
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

        {/* Decay warning */}
        {node.decayScore < 45 && ['mastered', 'functional', 'partial'].includes(node.state) && (
          <div className="kg-detail-section">
            <div className="kg-warn-block decay">
              <strong>Retention risk</strong>
              <p>
                You haven&apos;t revisited this topic recently. Memory of it has likely faded
                — a quick review before moving forward will strengthen what follows.
              </p>
              <div className="kg-decay-indicator">
                <span style={{ width: `${node.decayScore}%` }} />
                <em>{node.decayScore}% retained</em>
              </div>
            </div>
          </div>
        )}

        {/* Vulnerability — inherited risk from weak prerequisites */}
        {node.vulnerabilityRisk > 30 && node.state !== 'locked' && (
          <div className="kg-detail-section">
            <div className="kg-warn-block at-risk">
              <strong>Built on shaky ground</strong>
              <p>
                One or more prerequisites for this topic are still weak.
                Gaps in those foundations will make this harder to retain.
              </p>
            </div>
          </div>
        )}

        {/* Confusion density */}
        {node.doubtCount > 0 && (
          <div className="kg-detail-section">
            <div className="kg-detail-label">Confusion signal</div>
            <div className="kg-detail-meta">
              <div className="kg-meta-item">
                <div className="k">Questions asked</div>
                <div className="v">{node.doubtCount} doubt message{node.doubtCount !== 1 ? 's' : ''}</div>
              </div>
              <div className="kg-meta-item">
                <div className="k">Signal</div>
                <div className="v">
                  {node.doubtCount >= 6 ? 'High confusion' : node.doubtCount >= 3 ? 'Some confusion' : 'Low'}
                </div>
              </div>
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
              <div className="v">{incoming.length ? `${incoming.length} prerequisite${incoming.length !== 1 ? 's' : ''}` : 'Starts here'}</div>
            </div>
            <div className="kg-meta-item">
              <div className="k">Downstream impact</div>
              <div className="v" style={ node.downstreamImpact >= 4 ? { color: 'var(--kg-accent)', fontWeight: 600 } : {} }>
                {node.downstreamImpact > 0 ? `${node.downstreamImpact} concept${node.downstreamImpact !== 1 ? 's' : ''} depend on this` : 'Leaf node'}
              </div>
            </div>
          </div>
          {node.downstreamImpact >= 4 && !['mastered', 'locked'].includes(node.state) && (
            <div className="kg-bottleneck-note">
              ⚡ Bottleneck — mastering this unlocks {node.downstreamImpact} downstream concepts
            </div>
          )}
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
                <div className="kg-critical-path-hint">
                  <span className="kg-path-label">Critical path</span>
                  <p>Select this node to highlight the exact prerequisite chain you need to complete.</p>
                </div>
                {incoming.map((e, i) => {
                  const dep = data.nodes.find((nd) => nd.id === e.from)
                  if (!dep) return null
                  return (
                    <button key={i} className="kg-next-btn" onClick={() => onSelect(dep.id)}>
                      Start with: {dep.title} <span className="arrow">→</span>
                    </button>
                  )
                }).slice(0, 2)}
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
