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
  /** Remove a learner-made connection (userConnections doc id). */
  onDeleteConnection?: (connectionId: string) => void
}

/** Human label for what an edge MEANS — must match the canvas edge taxonomy. */
function connectionLabel(edge: { edgeType?: string; prereqStrength?: string | null; critical?: boolean }) {
  if (edge.critical) return 'priority path'
  const type = edge.edgeType ?? 'semantic'
  if (type === 'user') return 'your link'
  if (type === 'prerequisite') return edge.prereqStrength === 'soft' ? 'helpful before' : 'required'
  if (type === 'sequence') return 'course order'
  if (type === 'recommended') return 'suggested next'
  return 'related'
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

export function GraphDetailPanel({ node, data, courseId, onSelect, focusMode, onToggleFocus, onDeleteConnection }: Props) {
  if (!node) {
    const course = data.course
    const nextNode = data.nextBestNodeId ? data.nodes.find((n) => n.id === data.nextBestNodeId) : null

    return (
      <aside className="kg-detail">
        <div className="kg-overview-head">
          <div className="kg-overview-kicker">Knowledge Map</div>
          <h2 className="kg-overview-title">{course.title}</h2>
        </div>

        <div className="kg-detail-scroll">
          {/* Overall mastery bar */}
          <div className="kg-detail-section">
            <div className="kg-detail-label">Overall mastery</div>
            <div className="kg-mastery-bar">
              <span
                className="fill"
                style={{ width: `${course.masteryScore}%`, background: 'var(--kg-accent)' }}
              />
            </div>
            <div className="kg-mastery-text">
              <span>{course.topicCount} concept{course.topicCount !== 1 ? 's' : ''} in this course</span>
              <strong>{course.masteryScore}% mastered</strong>
            </div>
          </div>

          {/* State breakdown */}
          <div className="kg-detail-section">
            <div className="kg-detail-label">Progress breakdown</div>
            <div className="kg-detail-meta">
              {course.mastered > 0 && (
                <div className="kg-meta-item">
                  <div className="k">Mastered</div>
                  <div className="v" style={{ color: 'var(--kg-mastered)' }}>{course.mastered}</div>
                </div>
              )}
              {course.functional > 0 && (
                <div className="kg-meta-item">
                  <div className="k">Functional</div>
                  <div className="v" style={{ color: 'var(--kg-functional)' }}>{course.functional}</div>
                </div>
              )}
              {course.partial > 0 && (
                <div className="kg-meta-item">
                  <div className="k">Partial</div>
                  <div className="v" style={{ color: 'var(--kg-partial)' }}>{course.partial}</div>
                </div>
              )}
              {course.unstable > 0 && (
                <div className="kg-meta-item">
                  <div className="k">Unstable</div>
                  <div className="v" style={{ color: 'var(--kg-unstable)' }}>{course.unstable}</div>
                </div>
              )}
              {course.active > 0 && (
                <div className="kg-meta-item">
                  <div className="k">Active</div>
                  <div className="v" style={{ color: 'var(--kg-active)' }}>{course.active}</div>
                </div>
              )}
              <div className="kg-meta-item">
                <div className="k">Locked</div>
                <div className="v">{course.locked}</div>
              </div>
            </div>
          </div>

          {/* Next Best Node recommendation */}
          {nextNode && (
            <div className="kg-detail-section">
              <div className="kg-detail-label">Recommended next</div>
              <div className="kg-next-rec">
                <div className="kg-next-rec-info">
                  <span className={`kg-pdot ${nextNode.state}`} />
                  <div>
                    <div className="kg-next-rec-title">{nextNode.title}</div>
                    <div className="kg-next-rec-meta">{nextNode.branchTitle} · {stateLabel(nextNode.state)}</div>
                  </div>
                </div>
                <div className="kg-next-rec-actions">
                  <button className="kg-next-btn primary" onClick={() => onSelect(nextNode.id)}>
                    View in graph <span className="arrow">→</span>
                  </button>
                  <Link className="kg-next-btn" href={`/learn/${courseId}/${encodeURIComponent(nextNode.id)}`}>
                    Go to lesson
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Branch mastery breakdown */}
          {data.branches.length > 0 && (
            <div className="kg-detail-section">
              <div className="kg-detail-label">Branch progress</div>
              <div className="kg-branch-list">
                {data.branches.map((b) => (
                  <div key={b.id} className="kg-branch-row">
                    <div className="kg-branch-row-head">
                      <span className={`kg-branch-dot-sm ${b.color}`} />
                      <span className="kg-branch-row-name">{b.title}</span>
                      <span className="kg-branch-row-pct">{b.masteryScore}%</span>
                    </div>
                    <div className="kg-mastery-bar thin">
                      <span
                        className="fill"
                        style={{ width: `${b.masteryScore}%`, background: 'var(--kg-accent)' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Graph connectivity stats */}
          <div className="kg-detail-section">
            <div className="kg-detail-label">Graph connectivity</div>
            <div className="kg-detail-meta">
              <div className="kg-meta-item">
                <div className="k">Connected</div>
                <div className="v">{course.connectedCount} node{course.connectedCount !== 1 ? 's' : ''}</div>
              </div>
              <div className="kg-meta-item">
                <div className="k">Isolated</div>
                <div className="v"
                  style={course.isolatedCount > 0 ? { color: 'var(--kg-unstable)' } : {}}
                >
                  {course.isolatedCount}
                  {course.isolatedCount > 0 ? ' (no edges)' : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    )
  }

  const nodeById = (id: string) => data.nodes.find((n) => n.id === id)
  // All relationship kinds the canvas draws (prerequisite, sequence, recommended,
  // semantic) — the panel must agree with what the learner SEES connected.
  // Hard requirements sort first so the most binding relationships lead the list.
  const requiredFirst = (e: { edgeType: string; prereqStrength?: string | null }) =>
    e.edgeType === 'prerequisite' ? (e.prereqStrength === 'soft' ? 1 : 0) : e.edgeType === 'sequence' ? 2 : 3
  const incoming = data.edges
    .filter((e) => e.to === node.id && e.edgeType !== 'user')
    .sort((a, b) => requiredFirst(a) - requiredFirst(b))
  const outgoing = data.edges
    .filter((e) => e.from === node.id && e.edgeType !== 'user')
    .sort((a, b) => requiredFirst(a) - requiredFirst(b))
  // Learner-made connections touching this concept — undirected, own section.
  const userLinks = data.edges.filter(
    (e) => e.edgeType === 'user' && (e.from === node.id || e.to === node.id),
  )
  // "Builds from" counts only true requirements (hard prereqs + course order)
  const requiredIncoming = incoming.filter(
    (e) => (e.edgeType === 'prerequisite' && e.prereqStrength !== 'soft') || e.edgeType === 'sequence',
  )
  const n = node  // non-null alias for inner functions

  if (!node.teachable) {
    const branchConcepts = data.nodes
      .filter((candidate) => candidate.teachable && candidate.branch === node.branch)
      .slice(0, 10)

    return (
      <aside className="kg-detail">
        <div className="kg-detail-head">
          <div className="kg-detail-kicker">Course structure</div>
          <h2 className="kg-detail-title">{node.title}</h2>
          <div className="kg-detail-row">
            <span style={{ fontSize: 11, color: 'var(--kg-muted)' }}>Organizational landmark</span>
          </div>
        </div>
        <div className="kg-detail-scroll">
          <div className="kg-detail-section">
            <div className="kg-detail-label">About this group</div>
            <p style={{ color: 'var(--kg-muted)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              This node organizes related concepts. It does not represent a lesson, quiz, or mastery judgment.
            </p>
          </div>
          {branchConcepts.length > 0 && (
            <div className="kg-detail-section">
              <div className="kg-detail-label">Concepts in this area</div>
              <div className="kg-dep-list">
                {branchConcepts.map((concept) => (
                  <button key={concept.id} className="kg-dep-item" onClick={() => onSelect(concept.id)}>
                    <span
                      className="kg-branch-dot"
                      style={{ background: stateColorVar(concept.state), width: 8, height: 8 }}
                    />
                    <span>{concept.title}</span>
                    <span className="strength">{stateLabel(concept.state)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="kg-detail-section">
            <button className="kg-next-btn" onClick={onToggleFocus}>
              {focusMode ? 'Exit focus mode' : 'Focus this area'}
            </button>
          </div>
        </div>
      </aside>
    )
  }

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
              <div className="v">{requiredIncoming.length ? `${requiredIncoming.length} prerequisite${requiredIncoming.length !== 1 ? 's' : ''}` : 'Starts here'}</div>
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

        {/* Comes-before list — every drawn connection INTO this node */}
        <div className="kg-detail-section">
          <div className="kg-detail-label">Comes before this</div>
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
                    <span className="strength">{connectionLabel(e)}</span>
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
                    <span className="strength">{connectionLabel(e)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Learner-made connections */}
        {userLinks.length > 0 && (
          <div className="kg-detail-section">
            <div className="kg-detail-label">Your connections</div>
            <div className="kg-dep-list">
              {userLinks.map((e) => {
                const otherId = e.from === n.id ? e.to : e.from
                const other = nodeById(otherId)
                if (!other) return null
                return (
                  <div className="kg-user-link-item" key={e.connectionId ?? `${e.from}-${e.to}`}>
                    <button className="kg-dep-item" onClick={() => onSelect(other.id)} title={e.note ?? undefined}>
                      <span
                        className="kg-branch-dot"
                        style={{ background: 'var(--kg-accent)', width: 8, height: 8 }}
                      />
                      <span>{other.title}</span>
                      {e.note ? <span className="strength" title={e.note}>“{e.note.length > 26 ? `${e.note.slice(0, 26)}…` : e.note}”</span> : null}
                    </button>
                    {onDeleteConnection && e.connectionId ? (
                      <button
                        className="kg-user-link-remove"
                        type="button"
                        title="Remove this connection"
                        onClick={() => onDeleteConnection(e.connectionId!)}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
                {requiredIncoming.map((e, i) => {
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
