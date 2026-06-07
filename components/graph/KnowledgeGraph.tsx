'use client'

import { useMemo, useRef, useEffect, useState } from 'react'
import type { GraphData, GraphEdge, GraphNode, GraphNodeState } from '@/lib/graph/types'
import { heightFor, edgePath, stateColorVar, stateLabel, showProgress } from './graphUtils'

// ── Small rendering helpers ─────────────────────────────────────────────────

function StatePill({ state }: { state: GraphNodeState }) {
  return (
    <span className={`kg-state-pill ${state}`}>
      <span className={`kg-pdot ${state}`} />
      {stateLabel(state)}
    </span>
  )
}

function DifficultyBars({ value }: { value: number }) {
  return (
    <span className="kg-diff-bars" title="Concept depth">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= value ? 'on' : ''} />
      ))}
    </span>
  )
}

function ImportanceStack({ value }: { value: number }) {
  return (
    <span className="kg-imp-stack" title="Atlas weight">
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= value ? 'on' : ''} />
      ))}
    </span>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

interface KnowledgeGraphProps {
  data: GraphData
  selectedId: string | null
  focusId: string | null
  onSelect: (id: string) => void
  hoverId: string | null
  setHoverId: (id: string | null) => void
  showCritical: boolean
  showRegions: boolean
  showRecommended: boolean
  showWeak: boolean
  showLocked: boolean
  view: { x: number; y: number; k: number }
  setView: React.Dispatch<React.SetStateAction<{ x: number; y: number; k: number }>>
  criticalPathNodes?: Set<string>
  criticalPathEdges?: Set<string>
}

export function KnowledgeGraph({
  data,
  selectedId,
  focusId,
  onSelect,
  hoverId,
  setHoverId,
  showCritical,
  showRegions,
  showRecommended,
  showWeak,
  view,
  setView,
  criticalPathNodes = new Set(),
  criticalPathEdges = new Set(),
}: KnowledgeGraphProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; startX: number; startY: number } | null>(null)

  // Build lookup indexes
  const { nodeById, outAdj, inAdj } = useMemo(() => {
    const nodeById = new Map<string, GraphNode>()
    data.nodes.forEach((n) => nodeById.set(n.id, n))
    const outAdj = new Map<string, typeof data.edges>()
    const inAdj = new Map<string, typeof data.edges>()
    data.edges.forEach((e) => {
      if (!outAdj.has(e.from)) outAdj.set(e.from, [])
      if (!inAdj.has(e.to)) inAdj.set(e.to, [])
      outAdj.get(e.from)!.push(e)
      inAdj.get(e.to)!.push(e)
    })
    return { nodeById, outAdj, inAdj }
  }, [data])

  // 1-hop ego network for focus mode
  const egoSet = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    ;(outAdj.get(focusId) ?? []).forEach((e) => set.add(e.to))
    ;(inAdj.get(focusId) ?? []).forEach((e) => set.add(e.from))
    return set
  }, [focusId, outAdj, inAdj])

  // Pre-compute all edge geometries
  const edgeGeoms = useMemo(() => {
    return data.edges
      .filter((e) => showWeak || e.strength !== 'weak')
      .map((e) => {
        const a = nodeById.get(e.from)
        const b = nodeById.get(e.to)
        if (!a || !b) return null
        const ah = heightFor(a.importance)
        const bh = heightFor(b.importance)
        const start = { x: a.x + a.w, y: a.y + ah / 2 }
        const end   = { x: b.x,       y: b.y + bh / 2 }
        return { ...e, path: edgePath(start, end) }
      })
      .filter(Boolean) as Array<GraphEdge & { path: string }>
  }, [data.edges, nodeById, showWeak])

  // Highlighted edge indices for selected/hovered node
  const litEdges = useMemo(() => {
    const focus = selectedId ?? hoverId
    if (!focus) return null
    const s = new Set<number>()
    edgeGeoms.forEach((e, i) => {
      if (e.from === focus || e.to === focus) s.add(i)
    })
    return s
  }, [edgeGeoms, selectedId, hoverId])

  // ── Pan ──
  function onMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.kg-node-card')) return
    setDrag({ x: e.clientX, y: e.clientY, startX: view.x, startY: view.y })
  }

  useEffect(() => {
    if (!drag) return
    function onMove(e: MouseEvent) {
      setView((v) => ({ ...v, x: drag!.startX + (e.clientX - drag!.x), y: drag!.startY + (e.clientY - drag!.y) }))
    }
    function onUp() { setDrag(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [drag, setView])

  // ── Zoom ──
  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    const rect = stageRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setView((v) => {
      const next = Math.min(2, Math.max(0.25, v.k * factor))
      const k = next / v.k
      return { k: next, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k }
    })
  }

  const CANVAS_W = data.canvasW
  const CANVAS_H = data.canvasH

  return (
    <div
      ref={stageRef}
      className={`kg-canvas-stage${drag ? ' dragging' : ''}`}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
    >
      <div
        className="kg-canvas-inner"
        style={{
          transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`,
          width: CANVAS_W,
          height: CANVAS_H,
        }}
      >
        <svg width={CANVAS_W} height={CANVAS_H} style={{ display: 'block', overflow: 'visible' }}>
          {/* Branch swim-lane region bands */}
          {showRegions && data.regions?.map((r) => (
            <g key={r.id}>
              <rect
                className="kg-region"
                x={r.x} y={r.y} width={r.w} height={r.h}
                rx="14" ry="14"
              />
              <text
                className="kg-region-label"
                x={r.x + 18}
                y={r.y + 24}
              >
                {r.label}
              </text>
            </g>
          ))}
          <defs>
            <marker id="kg-edge-arrow" markerHeight="5" markerUnits="userSpaceOnUse" markerWidth="5" orient="auto" refX="4.6" refY="2.5" viewBox="0 0 5 5">
              <path className="kg-edge-arrow" d="M0.4,0.7 L4.6,2.5 L0.4,4.3 Z" />
            </marker>
            <marker id="kg-edge-arrow-highlight" markerHeight="5" markerUnits="userSpaceOnUse" markerWidth="5" orient="auto" refX="4.6" refY="2.5" viewBox="0 0 5 5">
              <path className="kg-edge-arrow-highlight" d="M0.4,0.7 L4.6,2.5 L0.4,4.3 Z" />
            </marker>
            <marker id="kg-edge-arrow-path" markerHeight="5" markerUnits="userSpaceOnUse" markerWidth="5" orient="auto" refX="4.6" refY="2.5" viewBox="0 0 5 5">
              <path style={{ fill: 'var(--kg-path-color)' }} d="M0.4,0.7 L4.6,2.5 L0.4,4.3 Z" />
            </marker>
          </defs>
          {/* Edges */}
          <g>
            {edgeGeoms.map((e, i) => {
              const isLit = litEdges?.has(i)
              const isFaded = egoSet && !(egoSet.has(e.from) && egoSet.has(e.to))
              const isCritical = showCritical && e.critical
              const isOnPath = criticalPathEdges.has(`${e.from}::${e.to}`)
              const cls = [
                'kg-edge',
                e.strength,
                isCritical ? 'critical' : '',
                isLit ? 'highlight' : '',
                isFaded ? 'faded' : '',
                isOnPath ? 'critical-path' : '',
              ].filter(Boolean).join(' ')
              return (
                <path
                  key={i}
                  className={cls}
                  d={e.path}
                  markerEnd={
                    isOnPath ? 'url(#kg-edge-arrow-path)' :
                    isLit ? 'url(#kg-edge-arrow-highlight)' :
                    e.strength !== 'weak' ? 'url(#kg-edge-arrow)' : undefined
                  }
                />
              )
            })}
          </g>

          {/* Nodes (via foreignObject for rich HTML layout) */}
          <g>
            {data.nodes.map((n) => {
              const h = heightFor(n.importance)
              const isSelected = selectedId === n.id
              const isFaded = egoSet && !egoSet.has(n.id)
              const isSuggested = showRecommended && n.suggested
              const isSearchDim = Boolean((n as GraphNode & { _dim?: boolean })._dim)
              const isOnPath = criticalPathNodes.has(n.id)
              // Vulnerability: show at-risk class when own risk >0 OR inherited risk >25
              const isAtRisk = n.state !== 'locked' && n.vulnerabilityRisk > 25
              // Decay: show for reviewed nodes that are going stale
              const isDecaying = ['mastered', 'functional', 'partial'].includes(n.state) && n.decayScore < 45
              // Bottleneck: top nodes by downstream impact (impact > 4 and not yet mastered)
              const isBottleneck = n.downstreamImpact >= 4 && !['mastered', 'locked'].includes(n.state)

              const cls = [
                'kg-node-card',
                `state-${n.state}`,
                isSelected ? 'selected' : '',
                n.current ? 'current' : '',
                isSuggested ? 'suggested' : '',
                n.misconception ? 'misconception' : '',
                isFaded ? 'faded' : '',
                isSearchDim ? 'search-dim' : '',
                isOnPath ? 'critical-path' : '',
                isAtRisk && !isOnPath ? 'at-risk' : '',
                isDecaying ? 'decaying' : '',
                n.falseConfidence ? 'false-confidence' : '',
              ].filter(Boolean).join(' ')

              return (
                <foreignObject
                  key={n.id}
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={h}
                  style={{ overflow: 'visible' }}
                >
                  <div
                    className={cls}
                    onClick={(e) => { e.stopPropagation(); onSelect(n.id) }}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    <div className="kg-node-head">
                      <span className="kg-node-title" title={n.title}>{n.title}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {isBottleneck && (
                          <span className="kg-badge bottleneck" title={`Unlocks ${n.downstreamImpact} concepts`}>
                            {n.downstreamImpact}
                          </span>
                        )}
                        {n.doubtCount > 0 && (
                          <span className="kg-badge doubts" title={`${n.doubtCount} questions asked here`}>
                            ?
                          </span>
                        )}
                        <ImportanceStack value={n.importance} />
                      </div>
                    </div>
                    <div className="kg-node-meta">
                      <StatePill state={n.state} />
                      <DifficultyBars value={n.difficulty} />
                    </div>
                    {showProgress(n.state) && (
                      <div className={`kg-node-prog ${n.state}`}>
                        <span style={{ width: `${n.mastery}%` }} />
                      </div>
                    )}
                    {isDecaying && (
                      <div className="kg-decay-bar">
                        <span style={{ width: `${n.decayScore}%` }} />
                      </div>
                    )}
                  </div>
                </foreignObject>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
