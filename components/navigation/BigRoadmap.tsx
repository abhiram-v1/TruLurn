'use client'

import Link from 'next/link'
import {
  IconCompass,
  IconLock,
  IconRoute,
  IconBinaryTree,
  IconNetwork,
  IconBrain,
  IconChartDots3,
  IconTopologyStar3,
  IconEye,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BranchState, TopicState } from '@/types'

type AtlasTopic = {
  id: string
  title: string
  state: TopicState
}

export type AtlasBranch = {
  id: string
  course_id: string
  title: string
  description: string
  state: BranchState
  active_topic_id: string | null
  topic_count: number
  mastered_count: number
  milestones?: string[]
  topics?: AtlasTopic[]
}

type AtlasPhase = 'done' | 'current' | 'available' | 'locked'

const NODE_W = 90
const NODE_H = 90
const DRAG_THRESHOLD = 4
const NODE_SPACING_Y = 190

const ICON_POOL: Icon[] = [
  IconCompass,
  IconRoute,
  IconBinaryTree,
  IconNetwork,
  IconBrain,
  IconChartDots3,
  IconTopologyStar3,
  IconEye,
]

function phaseLabel(phase: AtlasPhase) {
  return {
    done: 'Mastered',
    current: 'In progress',
    available: 'Ready to explore',
    locked: 'Sealed',
  }[phase]
}

function branchDestination(branch: AtlasBranch | { active_topic_id: string | null; id: string }, courseId: string) {
  return branch.active_topic_id
    ? `/learn/${courseId}/${encodeURIComponent(branch.active_topic_id)}`
    : `/course/${courseId}`
}

function phaseFor(branch: AtlasBranch, index: number, frontier: number): AtlasPhase {
  if (branch.state === 'mastered') return 'done'
  if (branch.state === 'in_progress') return 'current'
  if (index <= frontier + 1) return 'available'
  return 'locked'
}

type Pos = { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function BigRoadmap({
  branches,
  courseId,
  courseTitle = 'Your course',
}: {
  branches: AtlasBranch[]
  courseId: string
  courseTitle?: string
}) {
  const currentIndex = branches.findIndex((branch) => branch.state === 'in_progress')
  const masteredFrontier = branches.filter((branch) => branch.state === 'mastered').length - 1
  const frontier = currentIndex >= 0 ? currentIndex : masteredFrontier
  const enriched = useMemo(
    () => branches.map((branch, index) => ({
      ...branch,
      phase: phaseFor(branch, index, frontier),
      index,
    })),
    [branches, frontier],
  )

  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(600)

  // Track canvas resize dynamically to recalculate layout center
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    setCanvasWidth(el.getBoundingClientRect().width || 600)

    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setCanvasWidth(entry.contentRect.width)
        }
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const idsKey = enriched.map((branch) => branch.id).join('|')
  const baseLayout = useMemo(() => {
    const isMobile = canvasWidth < 520
    const centerX = canvasWidth / 2
    const map: Record<string, Pos> = {}
    enriched.forEach((branch, i) => {
      // Gentle curve offsets (winding serpentine trail)
      const offset = isMobile ? 0 : (i === 0 ? 0 : (i % 2 === 0 ? -60 : 60))
      map[branch.id] = {
        x: centerX + offset - NODE_W / 2,
        y: 80 + i * NODE_SPACING_Y,
      }
    })
    return map
  }, [idsKey, enriched.length, canvasWidth])

  const initialBranch = enriched.find((branch) => branch.phase === 'current')
    ?? enriched.find((branch) => branch.phase === 'available')
    ?? enriched[0]
  const [selectedId, setSelectedId] = useState(initialBranch?.id ?? '')

  const totalTopics = branches.reduce((sum, branch) => sum + Number(branch.topic_count || 0), 0)
  const masteredTopics = branches.reduce((sum, branch) => sum + Number(branch.mastered_count || 0), 0)
  const completePct = totalTopics ? Math.round((masteredTopics / totalTopics) * 100) : 0

  const [positions, setPositions] = useState<Record<string, Pos>>(baseLayout)
  const view = { x: 0, y: 0, k: 1 }

  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const viewRef = useRef(view)
  viewRef.current = view

  const nodeDragRef = useRef<{ id: string; cx: number; cy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const justDraggedRef = useRef(false)

  const posFor = (id: string): Pos => positions[id] ?? baseLayout[id] ?? { x: 0, y: 0 }

  const worldSize = useMemo(() => {
    let maxY = 0
    for (const id of Object.keys(baseLayout)) {
      const p = baseLayout[id]
      if (p.y + NODE_H > maxY) maxY = p.y + NODE_H
    }
    return { w: canvasWidth, h: maxY + 120 }
  }, [baseLayout, canvasWidth])

  // Topographical wavy contour lines in the background
  const contourPaths = useMemo(() => {
    const w = worldSize.w
    const h = worldSize.h
    if (w <= 0 || h <= 0) return []
    return [
      `M -50 ${h * 0.08} Q ${w * 0.25} ${h * 0.04}, ${w * 0.5} ${h * 0.12} T ${w + 50} ${h * 0.06}`,
      `M -50 ${h * 0.25} Q ${w * 0.3} ${h * 0.32}, ${w * 0.6} ${h * 0.2} T ${w + 50} ${h * 0.28}`,
      `M -50 ${h * 0.45} Q ${w * 0.15} ${h * 0.4}, ${w * 0.45} ${h * 0.5} T ${w + 50} ${h * 0.42}`,
      `M -50 ${h * 0.62} Q ${w * 0.35} ${h * 0.7}, ${w * 0.7} ${h * 0.58} T ${w + 50} ${h * 0.66}`,
      `M -50 ${h * 0.78} Q ${w * 0.2} ${h * 0.74}, ${w * 0.5} ${h * 0.84} T ${w + 50} ${h * 0.8}`,
      `M -50 ${h * 0.92} Q ${w * 0.4} ${h * 0.96}, ${w * 0.65} ${h * 0.88} T ${w + 50} ${h * 0.94}`
    ]
  }, [worldSize])

  useEffect(() => {
    setPositions(baseLayout)
  }, [baseLayout])

  const onNodePointerDown = useCallback((id: string, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = positionsRef.current[id] ?? baseLayout[id] ?? { x: 0, y: 0 }
    nodeDragRef.current = { id, cx: e.clientX, cy: e.clientY, ox: p.x, oy: p.y, moved: false }
  }, [baseLayout])

  const onNodePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = nodeDragRef.current
    if (!drag) return
    const k = viewRef.current.k
    const dx = (e.clientX - drag.cx) / k
    const dy = (e.clientY - drag.cy) / k
    if (Math.abs(e.clientX - drag.cx) > DRAG_THRESHOLD || Math.abs(e.clientY - drag.cy) > DRAG_THRESHOLD) {
      drag.moved = true
    }

    const basePos = baseLayout[drag.id] ?? { x: 0, y: 0 }
    const MAX_DRAG_OFFSET = 50
    const nextX = clamp(drag.ox + dx, basePos.x - MAX_DRAG_OFFSET, basePos.x + MAX_DRAG_OFFSET)
    const nextY = clamp(drag.oy + dy, basePos.y - MAX_DRAG_OFFSET, basePos.y + MAX_DRAG_OFFSET)

    setPositions((prev) => ({ ...prev, [drag.id]: { x: nextX, y: nextY } }))
  }, [baseLayout])

  const onNodePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = nodeDragRef.current
    if (drag) justDraggedRef.current = drag.moved
    nodeDragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  const onNodeClick = useCallback((id: string) => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return }
    setSelectedId(id)
  }, [])

  if (!branches.length) {
    return <div className="atlas-empty">This Atlas has no branches yet.</div>
  }

  const edges = enriched.slice(1).map((branch, i) => {
    const from = posFor(enriched[i].id)
    const to = posFor(branch.id)
    const ax = from.x + NODE_W / 2
    const ay = from.y + NODE_H / 2
    const bx = to.x + NODE_W / 2
    const by = to.y + NODE_H / 2
    const dy = Math.max(48, Math.abs(by - ay) * 0.5)
    return {
      key: `${enriched[i].id}-${branch.id}`,
      d: `M ${ax} ${ay} C ${ax} ${ay + dy}, ${bx} ${by - dy}, ${bx} ${by}`,
      earned: enriched[i].phase === 'done',
    }
  })

  return (
    <section className="atlas-experience" aria-label={`${courseTitle} Atlas`}>
      <header className="atlas-header">
        <p className="atlas-header-topic">{courseTitle.toUpperCase()}</p>
        <h1 className="atlas-header-title">Atlas</h1>
        <p className="atlas-header-desc">
          Earn your way up the trail. Each seal you master lights the path to the next.
        </p>
        
        <div className="atlas-pill-progress" aria-label={`${completePct}% complete`}>
          <div className="atlas-pills">
            {enriched.map((b) => (
              <span key={b.id} className={`atlas-pill-item state-${b.state}`} />
            ))}
          </div>
          <span className="atlas-pill-text">{completePct}% complete</span>
        </div>
      </header>

      <div className="atlas-body">
        <div ref={canvasRef} className="atlas-canvas">
          <div
            className="atlas-world"
            style={{
              width: worldSize.w,
              height: worldSize.h,
              position: 'relative',
            }}
          >
            <svg className="atlas-edges" width={worldSize.w} height={worldSize.h} aria-hidden="true">
              {/* Topographical contour background lines */}
              {contourPaths.map((d, i) => (
                <path
                  key={`contour-${i}`}
                  className="atlas-contour-line"
                  d={d}
                />
              ))}

              {/* Back solid track line */}
              {edges.map((edge) => (
                <path
                  key={edge.key}
                  className={`atlas-edge${edge.earned ? ' earned' : ''}`}
                  d={edge.d}
                />
              ))}
              {/* Foreground dotted trail line */}
              {edges.map((edge) => (
                <path
                  key={edge.key + '-dots'}
                  className={`atlas-edge-dots${edge.earned ? ' earned' : ''}`}
                  d={edge.d}
                />
              ))}
            </svg>

            {enriched.map((branch, index) => {
              const NodeIcon = ICON_POOL[index % ICON_POOL.length]
              const progress = branch.topic_count
                ? Math.round((branch.mastered_count / branch.topic_count) * 100)
                : 0
              const pos = posFor(branch.id)
              const isSelected = selectedId === branch.id
              
              const radius = 45
              const stroke = 3
              const normalizedRadius = radius - stroke * 2
              const circumference = normalizedRadius * 2 * Math.PI
              const strokeDashoffset = circumference - (progress / 100) * circumference

              return (
                <div
                  key={branch.id}
                  className="atlas-node-container"
                  style={{
                    position: 'absolute',
                    transform: `translate(${pos.x}px, ${pos.y}px)`,
                    width: NODE_W,
                    height: NODE_H,
                  }}
                >
                  <svg className="atlas-node-progress-ring" width={NODE_W} height={NODE_H}>
                    <circle
                      className="progress-ring-track"
                      stroke="var(--atlas-line)"
                      fill="transparent"
                      strokeWidth={stroke}
                      r={normalizedRadius}
                      cx={radius}
                      cy={radius}
                    />
                    {branch.phase !== 'locked' && (
                      <circle
                        className="progress-ring-fill"
                        stroke={branch.phase === 'done' ? 'var(--color-detail-sage)' : 'var(--color-accent)'}
                        fill="transparent"
                        strokeWidth={stroke + 1}
                        strokeDasharray={circumference + ' ' + circumference}
                        style={{ strokeDashoffset }}
                        strokeLinecap="round"
                        r={normalizedRadius}
                        cx={radius}
                        cy={radius}
                      />
                    )}
                  </svg>

                  <button
                    type="button"
                    className={`atlas-node-circle phase-${branch.phase}${isSelected ? ' selected' : ''}`}
                    onPointerDown={(e) => onNodePointerDown(branch.id, e)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={onNodePointerUp}
                    onClick={() => onNodeClick(branch.id)}
                    aria-label={`${branch.title}, ${phaseLabel(branch.phase)}`}
                    aria-pressed={isSelected}
                  >
                    <span className="atlas-node-circle-number">
                      {index + 1}
                    </span>
                  </button>

                  {isSelected && (
                    <div className="atlas-node-popover popover-right">
                      <div className="atlas-popover-arrow" />
                      <div className="atlas-popover-header">
                        <span className="atlas-popover-eyebrow">Branch {String(index + 1).padStart(2, '0')}</span>
                        <span className="atlas-popover-count">{branch.mastered_count}/{branch.topic_count}</span>
                      </div>
                      <h3 className="atlas-popover-title">{branch.title}</h3>
                      <p className="atlas-popover-desc">{branch.description}</p>
                      
                      <div className="atlas-popover-dots">
                        {(branch.topics ?? []).map((topic) => {
                          const stateClass = `state-${topic.state}`
                          return (
                            <span
                              key={topic.id}
                              className={`atlas-popover-dot ${stateClass}`}
                              title={topic.title}
                            />
                          )
                        })}
                      </div>

                      <div className="atlas-popover-foot">
                        <div className="atlas-popover-status">
                          <span className={`status-dot ${branch.phase}`} />
                          {phaseLabel(branch.phase).toUpperCase()}
                        </div>
                        {branch.phase !== 'locked' ? (
                          <Link className="atlas-popover-cta" href={branchDestination(branch, courseId)}>
                            {branch.phase === 'done' ? 'Review' : 'Continue'} →
                          </Link>
                        ) : (
                          <span className="atlas-popover-locked-label">Locked</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="atlas-canvas-hint" aria-hidden="true">
            Drag a card to offset · scroll to explore the map
          </div>
        </div>
      </div>
    </section>
  )
}
