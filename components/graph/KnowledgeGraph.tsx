'use client'

import { useMemo, useRef, useEffect, useState } from 'react'
import type { GraphData, GraphEdge, GraphNode, GraphNodeState } from '@/lib/graph/types'
import {
  stateLabel,
  showProgress,
  rampColor,
  cardEdgePath,
  crossBranchArc,
  confidenceToColor,
  reviewStateClass,
  type Rect,
} from './graphUtils'

// ── Small card sub-components (original rectangular node design) ──────────────

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
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= value ? 'on' : ''} />)}
    </span>
  )
}

interface KnowledgeGraphProps {
  data: GraphData
  selectedId: string | null
  focusId: string | null
  onSelect: (id: string) => void
  hoverId: string | null
  setHoverId: (id: string | null) => void
  showCritical: boolean
  showRegions: boolean        // toggles branch boxes
  showRecommended: boolean
  showSemantic: boolean
  showAllConnections: boolean
  showLocked: boolean
  view: { x: number; y: number; k: number }
  setView: React.Dispatch<React.SetStateAction<{ x: number; y: number; k: number }>>
  criticalPathNodes?: Set<string>
  criticalPathEdges?: Set<string>
  collapsedBranches?: Set<string>   // collapsed branch FAMILY ids
  onToggleBranch?: (familyId: string) => void
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
  showSemantic,
  showAllConnections,
  view,
  setView,
  criticalPathNodes = new Set(),
  criticalPathEdges = new Set(),
  collapsedBranches = new Set(),
  onToggleBranch,
}: KnowledgeGraphProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const k = view.k
  const lod = k < 0.5 ? 'standard' : 'full'

  // ── Viewport size (for virtualization) ──
  const [stageSize, setStageSize] = useState({ w: 1400, h: 900 })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStageSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visibleNodes = useMemo(
    () => (collapsedBranches.size > 0
      ? data.nodes.filter((n) => !collapsedBranches.has(n.branchFamily))
      : data.nodes),
    [data.nodes, collapsedBranches],
  )

  const { nodeById, outAdj, inAdj } = useMemo(() => {
    const nodeById = new Map<string, GraphNode>()
    visibleNodes.forEach((n) => nodeById.set(n.id, n))
    const outAdj = new Map<string, GraphEdge[]>()
    const inAdj = new Map<string, GraphEdge[]>()
    data.edges.forEach((e) => {
      if (!nodeById.has(e.from) || !nodeById.has(e.to)) return
      if (!outAdj.has(e.from)) outAdj.set(e.from, [])
      if (!inAdj.has(e.to)) inAdj.set(e.to, [])
      outAdj.get(e.from)!.push(e)
      inAdj.get(e.to)!.push(e)
    })
    return { nodeById, outAdj, inAdj }
  }, [visibleNodes, data.edges])

  const egoSet = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    ;(outAdj.get(focusId) ?? []).forEach((e) => set.add(e.to))
    ;(inAdj.get(focusId) ?? []).forEach((e) => set.add(e.from))
    return set
  }, [focusId, outAdj, inAdj])

  const rectOf = (n: GraphNode): Rect => ({ x: n.x, y: n.y, w: n.w, h: n.h })

  const redundantHardEdges = useMemo(() => {
    const hardEdges = data.edges.filter(
      (edge) => edge.edgeType === 'prerequisite' && edge.prereqStrength !== 'soft',
    )
    const adjacency = new Map<string, string[]>()
    hardEdges.forEach((edge) => {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
      adjacency.get(edge.from)!.push(edge.to)
    })

    const redundant = new Set<string>()
    for (const edge of hardEdges) {
      const queue = (adjacency.get(edge.from) ?? []).filter((target) => target !== edge.to)
      const visited = new Set<string>([edge.from])
      while (queue.length) {
        const current = queue.shift()!
        if (current === edge.to) {
          redundant.add(`${edge.from}::${edge.to}`)
          break
        }
        if (visited.has(current)) continue
        visited.add(current)
        queue.push(...(adjacency.get(current) ?? []))
      }
    }
    return redundant
  }, [data.edges])

  // ── Edge geometry + relationship meaning ──
  // Edge kinds carry distinct meaning so we never draw fake relationships:
  //   required — prerequisite / sequence (same family): solid line + arrow
  //   related  — recommended (same family): thin line
  //   soft     — semantic / optional (same family): dashed line
  //   cross    — any edge between different branch families: curved arc + arrow
  //   user     — learner-created connection: always visible, accent-coloured
  type EdgeKind = 'required' | 'related' | 'soft' | 'cross' | 'user'
  const edgeGeoms = useMemo(() => {
    return data.edges
      .filter((e) => {
        // Learner-made connections are the point of the personal graph —
        // never hidden behind relationship filters.
        if (e.edgeType === 'user') return true
        if (showAllConnections) return true
        if (e.edgeType === 'prerequisite' && e.prereqStrength !== 'soft') {
          return !redundantHardEdges.has(`${e.from}::${e.to}`)
        }
        if (e.edgeType === 'recommended' || e.edgeType === 'sequence') return showRecommended
        return showSemantic
      })
      .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
      .map((e) => {
        const a = nodeById.get(e.from)!
        const b = nodeById.get(e.to)!
        const et = e.edgeType ?? 'sequence'
        const crossFamily = a.branchFamily !== b.branchFamily
        let kind: EdgeKind
        if (et === 'user') kind = 'user'
        else if (crossFamily) kind = 'cross'
        // A soft prerequisite (AI-tagged) is a dashed soft link, not a hard required one.
        else if (et === 'prerequisite') kind = e.prereqStrength === 'soft' ? 'soft' : 'required'
        else if (et === 'sequence') kind = 'required'
        else if (et === 'recommended') kind = 'related'
        else kind = 'soft'
        const path = kind === 'cross' || (kind === 'user' && crossFamily)
          ? crossBranchArc(rectOf(a), rectOf(b))
          : cardEdgePath(rectOf(a), rectOf(b))
        const minX = Math.min(a.x, b.x)
        const minY = Math.min(a.y, b.y)
        const maxX = Math.max(a.x + a.w, b.x + b.w)
        const maxY = Math.max(a.y + a.h, b.y + b.h)
        return { ...e, path, kind, edgeType: et, minX, minY, maxX, maxY }
      })
  }, [data.edges, nodeById, redundantHardEdges, showRecommended, showSemantic, showAllConnections])

  const litEdges = useMemo(() => {
    const focus = selectedId ?? hoverId
    if (!focus) return null
    const s = new Set<number>()
    edgeGeoms.forEach((e, i) => { if (e.from === focus || e.to === focus) s.add(i) })
    return s
  }, [edgeGeoms, selectedId, hoverId])

  // ── Critical-path rail (the learning spine) ──
  const spineIds = useMemo(() => new Set(data.criticalPath ?? []), [data.criticalPath])
  const spineSegments = useMemo(() => {
    const path = data.criticalPath ?? []
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    for (let i = 0; i < path.length - 1; i++) {
      const a = nodeById.get(path[i])
      const b = nodeById.get(path[i + 1])
      if (!a || !b) continue
      segs.push({ x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 })
    }
    return segs
  }, [data.criticalPath, nodeById])

  // ── Pan / zoom ──
  function onMouseDown(e: React.MouseEvent) {
    const t = e.target as Element
    if (t.closest('.kg-node-card')) return
    if (t.closest('.kg-box-toggle')) return
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

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    const rect = stageRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setView((v) => {
      const next = Math.min(2, Math.max(0.2, v.k * factor))
      const kk = next / v.k
      return { k: next, x: mx - (mx - v.x) * kk, y: my - (my - v.y) * kk }
    })
  }

  const CW = data.canvasW
  const CH = data.canvasH

  // ── Virtualization: only render geometry intersecting the viewport (+margin) ──
  const CULL = 600 // canvas-space margin so nodes appear slightly before scrolling in
  const viewMinX = -view.x / view.k - CULL
  const viewMinY = -view.y / view.k - CULL
  const viewMaxX = (-view.x + stageSize.w) / view.k + CULL
  const viewMaxY = (-view.y + stageSize.h) / view.k + CULL
  const inViewport = (x: number, y: number, w: number, h: number) =>
    x + w >= viewMinX && x <= viewMaxX && y + h >= viewMinY && y <= viewMaxY

  return (
    <div
      ref={stageRef}
      className={`kg-canvas-stage${drag ? ' dragging' : ''}`}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
    >
      <div
        className="kg-canvas-inner"
        style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`, width: CW, height: CH }}
      >
        <svg width={CW} height={CH} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <marker id="kg-arrow-req" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0.5,0.6 L5,3 L0.5,5.4 Z" fill="var(--kg-required-line)" />
            </marker>
            <marker id="kg-arrow-cross" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0.5,0.6 L5,3 L0.5,5.4 Z" fill="var(--kg-cross-line)" />
            </marker>
            <marker id="kg-arrow-lit" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0.5,0.6 L5,3 L0.5,5.4 Z" fill="var(--kg-accent)" />
            </marker>
          </defs>

          {/* ── Layer 0: dashed branch boxes ── */}
          {showRegions && data.boxes?.map((box) => {
            const collapsed = collapsedBranches.has(box.family)
            const ramp = rampColor(box.colourRamp)
            return (
              <g
                key={box.id}
                className={`kg-box-group${collapsed ? ' collapsed' : ''}`}
              >
                <rect
                  className="kg-box"
                  x={box.x} y={box.y}
                  width={box.w} height={collapsed ? 42 : box.h}
                  rx="14" ry="14"
                  style={{ stroke: ramp.border, fill: ramp.tint }}
                />
                <rect
                  className="kg-box-header"
                  x={box.x} y={box.y}
                  width={box.w} height={42}
                  rx="14" ry="14"
                  style={{ fill: ramp.tint }}
                />
                <rect
                  className="kg-box-header-mask"
                  x={box.x} y={box.y + 28}
                  width={box.w} height={14}
                  style={{ fill: ramp.tint }}
                />
                <g
                  className="kg-box-toggle"
                  onClick={(e) => { e.stopPropagation(); onToggleBranch?.(box.family) }}
                  style={onToggleBranch ? { cursor: 'pointer' } : undefined}
                >
                  <rect x={box.x} y={box.y} width={box.w} height={42} fill="transparent" />
                  {onToggleBranch && (
                    <text className="kg-box-chevron" x={box.x + 15} y={box.y + 26} style={{ fill: ramp.border }}>
                      {collapsed ? '▸' : '▾'}
                    </text>
                  )}
                  <text className="kg-box-label" x={box.x + (onToggleBranch ? 30 : 16)} y={box.y + 26} style={{ fill: ramp.border }}>
                    {box.label}
                  </text>
                  <text className="kg-box-count" x={box.x + box.w - 16} y={box.y + 26} style={{ fill: ramp.border }}>
                    {collapsed ? `${box.nodeCount ?? 0} hidden` : `${box.nodeCount ?? 0} concepts`}
                  </text>
                </g>
              </g>
            )
          })}

          {/* ── Layer 0.5: critical-path rail (the learning spine / main route) ── */}
          <g>
            {spineSegments.map((s, i) => {
              if (!inViewport(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))) return null
              return <line key={i} className="kg-spine-rail" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
            })}
          </g>

          {/* ── Layer 1: stored graph relationships ── */}
          <g>
            {edgeGeoms.map((e, i) => {
              if (!inViewport(e.minX, e.minY, e.maxX - e.minX, e.maxY - e.minY)) return null
              const isLit = litEdges?.has(i)
              const isMutedBySelection = Boolean(litEdges && !isLit)
              const isFaded = egoSet && !(egoSet.has(e.from) && egoSet.has(e.to))
              const isCritical = showCritical && e.critical
              const isOnPath = criticalPathEdges.has(`${e.from}::${e.to}`)
              // Score-based visual encoding: edge thickness from importance, opacity from confidence
              const scores = e.scores
              const scoreClass = scores
                ? scores.importance >= 70 ? 'score-strong'
                : scores.importance >= 40 ? 'score-medium'
                : 'score-weak'
                : ''
              const edgeOpacity = scores && !isLit && !isOnPath && !isMutedBySelection && !isFaded
                ? Math.max(0.15, scores.confidence / 100 * 0.9)
                : undefined

              const cls = [
                'kg-link',
                e.kind,
                `et-${e.edgeType}`,
                e.strength,
                scoreClass,
                isCritical ? 'critical' : '',
                isLit ? 'lit' : '',
                isMutedBySelection ? 'muted-by-selection' : '',
                isFaded ? 'faded' : '',
                isOnPath ? 'on-path' : '',
              ].filter(Boolean).join(' ')
              const marker = isOnPath || isLit ? 'url(#kg-arrow-lit)'
                : e.kind === 'required' ? 'url(#kg-arrow-req)'
                : e.kind === 'cross' ? 'url(#kg-arrow-cross)'
                : undefined
              // User connections are undirected associations — no arrowhead.
              if (e.kind === 'user') {
                return (
                  <path key={i} className={cls} d={e.path} style={edgeOpacity !== undefined ? { opacity: edgeOpacity } : undefined}>
                    {e.note ? <title>{e.note}</title> : null}
                  </path>
                )
              }
              return <path key={i} className={cls} d={e.path} markerEnd={marker} style={edgeOpacity !== undefined ? { opacity: edgeOpacity } : undefined} />
            })}
          </g>

          {/* ── Layer 2: node cards ── */}
          <g>
            {visibleNodes.map((n) => {
              if (!inViewport(n.x, n.y, n.w, n.h)) return null
              // An unboxed spine landmark: spine type AND not living inside a box.
              // A convergence LEAF keeps its box + full card, just flagged.
              const isSpine = n.boxId === null && n.nodeType !== 'branch'
              const isSelected = selectedId === n.id
              const isFaded = egoSet && !egoSet.has(n.id)
              const isSuggested = showRecommended && n.suggested
              const isDim = Boolean((n as GraphNode & { _dim?: boolean })._dim)
              const isOnPath = criticalPathNodes.has(n.id)
              const isAtRisk = n.state !== 'locked' && n.vulnerabilityRisk > 25
              const isDecaying = ['mastered', 'functional', 'partial'].includes(n.state) && n.decayScore < 45
              const isBottleneck = n.downstreamImpact >= 4 && !['mastered', 'locked'].includes(n.state)
              // Earned-strength tier — visual weight in the personal knowledge view.
              const ks = n.knowledgeStrength ?? 0
              const ksTier = ks >= 70 ? 'ks-solid' : ks >= 40 ? 'ks-growing' : 'ks-budding'
              // Graph-manager visual encodings
              const hasConf = n.confidenceScore !== undefined
              const confColor = hasConf ? confidenceToColor(n.confidenceScore!) : undefined
              // Glow for high recency (decayScore > 85 means knowledge is very fresh)
              const isRecentlyActive = n.decayScore >= 85 && n.state !== 'locked'

              const cls = [
                'kg-node-card',
                `state-${n.state}`,
                ksTier,
                isSpine ? 'spine' : 'branch-node',
                isSpine ? n.nodeType : '',
                spineIds.has(n.id) ? 'on-spine' : '',
                !isSpine && n.isConvergence ? 'convergence' : '',
                lod === 'standard' ? 'lod-standard' : '',
                isSelected ? 'selected' : '',
                n.current ? 'current' : '',
                isSuggested ? 'suggested' : '',
                n.misconception ? 'misconception' : '',
                isFaded || isDim ? 'faded' : '',
                isOnPath ? 'critical-path' : '',
                isAtRisk && !isOnPath ? 'at-risk' : '',
                isDecaying ? 'decaying' : '',
                n.falseConfidence ? 'false-confidence' : '',
                reviewStateClass(n.reviewState),
                hasConf ? 'has-confidence-score' : '',
                isRecentlyActive && !isDecaying ? 'recently-active' : '',
              ].filter(Boolean).join(' ')

              // Build inline style: confidence-tinted left border + glow color
              const nodeStyle: React.CSSProperties & Record<string, string> = {}
              if (hasConf && confColor) {
                nodeStyle.borderLeftColor = confColor
              }
              if ((isRecentlyActive || hasConf) && confColor) {
                nodeStyle['--kg-glow-color'] = `${confColor}4D`
              }

              return (
                <g key={n.id}>
                  {n.current && (
                    <rect
                      className="kg-current-ring-rect"
                      x={n.x - 6} y={n.y - 6}
                      width={n.w + 12} height={n.h + 12}
                      rx="13" ry="13"
                    />
                  )}
                  <foreignObject x={n.x} y={n.y} width={n.w} height={n.h} style={{ overflow: 'visible' }}>
                    <div
                      className={cls}
                      style={Object.keys(nodeStyle).length ? nodeStyle : undefined}
                      onClick={(e) => { e.stopPropagation(); onSelect(n.id) }}
                      onMouseEnter={() => setHoverId(n.id)}
                      onMouseLeave={() => setHoverId(null)}
                    >
                      {/* Real element, NOT ::before — pseudo-elements collide with the
                          .selected halo's ::before and blank the whole card. */}
                      {!isSpine && n.isConvergence && (
                        <span className="kg-converge-mark" aria-hidden>◆</span>
                      )}
                      <div className="kg-node-head">
                        <span className="kg-node-title" title={n.title}>{n.title}</span>
                        <div className="kg-node-badges">
                          {isBottleneck && (
                            <span className="kg-badge bottleneck" title={`Unlocks ${n.downstreamImpact} concepts`}>
                              {n.downstreamImpact}
                            </span>
                          )}
                          {n.doubtCount > 0 && (
                            <span className="kg-badge doubts" title={`${n.doubtCount} questions asked here`}>?</span>
                          )}
                        </div>
                      </div>
                      {!isSpine && (
                        <div className="kg-node-meta">
                          <StatePill state={n.state} />
                          <DifficultyBars value={n.difficulty} />
                        </div>
                      )}
                      {!isSpine && showProgress(n.state) && (
                        <div className={`kg-node-prog ${n.state}`}>
                          <span style={{ width: `${n.mastery}%` }} />
                        </div>
                      )}
                      {isDecaying && (
                        <div className="kg-decay-bar"><span style={{ width: `${n.decayScore}%` }} /></div>
                      )}
                    </div>
                  </foreignObject>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
