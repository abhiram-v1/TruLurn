// Pure utility functions shared between graph rendering components.

import type { GraphElementReviewState, GraphNodeState } from '@/lib/graph/types'

// ── Branch family colour ramps ───────────────────────────────────────────────
// Each branch family keeps a consistent colour across all its layers.
//
// KNOWN COLLISION (flagged, not silently fixed — repainting the palette is a
// visual-design call, not a logic fix): the "blue" branch-family ramp below
// (--kg-ramp-blue-*, e.g. #185FA5/#3B89D6) and the confidence-gradient's
// "Highly Stable" step in confidenceToColor() below (#2563EB) are two
// distinct, independently-rendered blues that can appear on screen at the
// same time with different meanings (branch identity vs. confidence score).
// `--kg-accent` (the active/critical-path highlight colour) is NOT part of
// this collision — it's orange (see app/styles/*.css), not blue.

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

// ── Multi-spectrum confidence → color (11-step gradient) ─────────────────
// Maps a 0–100 confidence score to a color that encodes knowledge certainty.
// Deep Red (very uncertain) → Magenta (critical, high-confidence core).

export function confidenceToColor(confidence: number): string {
  if (confidence >= 95) return '#C026D3'  // Magenta  — High Importance + High Confidence
  if (confidence >= 88) return '#7C3AED'  // Purple   — Critical / Core Knowledge
  if (confidence >= 80) return '#4F46E5'  // Indigo   — Long-Term Stable
  if (confidence >= 72) return '#2563EB'  // Blue     — Highly Stable (collides with the branch-ramp "blue" — see the note above RAMPS)
  if (confidence >= 63) return '#0891B2'  // Cyan     — Verified Confidence
  if (confidence >= 54) return '#0D9488'  // Teal     — Strong Confidence
  if (confidence >= 44) return '#16A34A'  // Green    — High Confidence
  if (confidence >= 34) return '#65A30D'  // Lime     — Emerging Confidence
  if (confidence >= 24) return '#CA8A04'  // Yellow   — Moderate Confidence
  if (confidence >= 14) return '#EA580C'  // Orange   — Low Confidence
  return '#DC2626'                         // Deep Red — Very Low Confidence
}

// ── Review state → CSS border-style ──────────────────────────────────────

export function reviewStateToBorderStyle(reviewState?: GraphElementReviewState | string): string {
  switch (reviewState) {
    case 'verified':
    case 'confirmed':
    case 'observed':    return 'solid'
    case 'inferred':
    case 'proposed':    return 'dashed'
    case 'deprecated':
    case 'contradicted': return 'dotted'
    default:            return 'solid'
  }
}

// ── Review state → CSS class suffix ──────────────────────────────────────

export function reviewStateClass(reviewState?: GraphElementReviewState | string): string {
  if (!reviewState) return ''
  return `review-${reviewState}`
}
