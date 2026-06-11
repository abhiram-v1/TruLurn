// Pure utility functions shared between graph rendering components.

import type { GraphNodeState } from '@/lib/graph/types'

// ── Branch family colour ramps ───────────────────────────────────────────────
// Each branch family keeps a consistent colour across all its layers.

export interface RampColor { border: string; line: string; tint: string }

const RAMPS: Record<string, RampColor> = {
  teal:   { border: 'var(--kg-ramp-teal-border)', line: 'var(--kg-ramp-teal-line)', tint: 'var(--kg-ramp-teal-tint)' },
  blue:   { border: 'var(--kg-ramp-blue-border)', line: 'var(--kg-ramp-blue-line)', tint: 'var(--kg-ramp-blue-tint)' },
  amber:  { border: 'var(--kg-ramp-amber-border)', line: 'var(--kg-ramp-amber-line)', tint: 'var(--kg-ramp-amber-tint)' },
  green:  { border: 'var(--kg-ramp-green-border)', line: 'var(--kg-ramp-green-line)', tint: 'var(--kg-ramp-green-tint)' },
  purple: { border: 'var(--kg-ramp-purple-border)', line: 'var(--kg-ramp-purple-line)', tint: 'var(--kg-ramp-purple-tint)' },
  coral:  { border: 'var(--kg-ramp-coral-border)', line: 'var(--kg-ramp-coral-line)', tint: 'var(--kg-ramp-coral-tint)' },
}

export function rampColor(ramp: string): RampColor {
  return RAMPS[ramp] ?? RAMPS.blue
}

// ── Edge routing for the recursive-spine layout ──────────────────────────────
// Anchors are computed from card rectangles (x, y, w, h = top-left + size).

export interface Rect { x: number; y: number; w: number; h: number }

const cx = (r: Rect) => r.x + r.w / 2
const cy = (r: Rect) => r.y + r.h / 2

/**
 * Structural edge between two cards. Routes vertically (bottom→top) when the
 * target sits below the source — the within-box / spine→box case — otherwise
 * side-to-side. A smooth cubic bezier in both directions.
 */
export function cardEdgePath(a: Rect, b: Rect): string {
  const leftToRight = cx(b) >= cx(a)
  const ax = leftToRight ? a.x + a.w : a.x
  const bx = leftToRight ? b.x : b.x + b.w
  const ay = cy(a), by = cy(b)
  const direction = leftToRight ? 1 : -1
  const gap = Math.abs(bx - ax)
  const elbow = ax + direction * Math.min(38, Math.max(20, gap / 2))
  const radius = Math.min(10, Math.abs(by - ay) / 2, Math.abs(bx - elbow) / 2)
  const verticalDirection = by >= ay ? 1 : -1
  return [
    `M${ax},${ay}`,
    `H${elbow - direction * radius}`,
    `Q${elbow},${ay} ${elbow},${ay + verticalDirection * radius}`,
    `V${by - verticalDirection * radius}`,
    `Q${elbow},${by} ${elbow + direction * radius},${by}`,
    `H${bx}`,
  ].join(' ')
}

/**
 * Cross-branch edge — a curved arc that bows sideways and routes AROUND box
 * exteriors (it connects card edges, never passing through a box). Visually
 * distinct from structural edges (the renderer dashes it).
 */
export function crossBranchArc(a: Rect, b: Rect): string {
  const leftToRight = cx(b) >= cx(a)
  const ax = leftToRight ? a.x + a.w : a.x
  const bx = leftToRight ? b.x : b.x + b.w
  const ay = cy(a), by = cy(b)
  const direction = leftToRight ? 1 : -1
  const gap = Math.abs(bx - ax)
  const sourceLane = ax + direction * Math.min(48, Math.max(24, gap * 0.18))
  const targetLane = bx - direction * Math.min(34, Math.max(18, gap * 0.12))
  return `M${ax},${ay} H${sourceLane} C${sourceLane},${ay} ${sourceLane},${by} ${targetLane},${by} H${bx}`
}

/** CSS custom-property color for a given state (used in minimap + node prog). */
export function stateColorVar(state: GraphNodeState): string {
  const map: Record<GraphNodeState, string> = {
    mastered:   'var(--kg-mastered-dot)',
    functional: 'var(--kg-functional-dot)',
    partial:    'var(--kg-partial-dot)',
    unstable:   'var(--kg-unstable-dot)',
    active:     'var(--kg-accent)',
    locked:     'var(--kg-locked-line)',
  }
  return map[state] ?? 'var(--kg-line)'
}

/** Human-readable label for each state. */
export function stateLabel(state: GraphNodeState): string {
  const map: Record<GraphNodeState, string> = {
    mastered:   'Mastered',
    functional: 'Functional',
    partial:    'Developing',
    unstable:   'Needs review',
    active:     'Active',
    locked:     'Locked',
  }
  return map[state] ?? state
}

/** Whether a given mastery-state warrants showing the progress bar. */
export function showProgress(state: GraphNodeState): boolean {
  return state !== 'locked'
}
