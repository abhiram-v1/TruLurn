// Pure utility functions shared between graph rendering components.

import type { GraphNodeState } from '@/lib/graph/types'

/** Node card height based on importance tier. */
export function heightFor(importance: 1 | 2 | 3): number {
  if (importance === 3) return 96
  if (importance === 2) return 88
  return 78
}

/** Bezier path from right-anchor of source → left-anchor of target. */
export function edgePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
): string {
  const dx = Math.max(40, (b.x - a.x) * 0.55)
  const c1 = `${a.x + dx},${a.y}`
  const c2 = `${b.x - dx},${b.y}`
  return `M${a.x},${a.y} C${c1} ${c2} ${b.x},${b.y}`
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
