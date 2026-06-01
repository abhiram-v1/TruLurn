'use client'

import type { GraphData } from '@/lib/graph/types'
import { stateColorVar } from './graphUtils'

interface Props {
  data: GraphData
  selectedId: string | null
  view: { x: number; y: number; k: number }
  setView: React.Dispatch<React.SetStateAction<{ x: number; y: number; k: number }>>
}

const MM_W = 200
const MM_H = 110

export function GraphMinimap({ data, selectedId, view, setView }: Props) {
  const CW = data.canvasW
  const CH = data.canvasH
  const sx = MM_W / CW
  const sy = MM_H / CH

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const targetX = mx / sx
    const targetY = my / sy
    // Center the stage viewport on the clicked canvas point
    setView((v) => ({ ...v, x: -targetX * v.k + 500, y: -targetY * v.k + 320 }))
  }

  // Approximate stage size for viewport rect
  const stageW = 1100
  const stageH = 720

  return (
    <div className="kg-canvas-overlay kg-minimap">
      <div className="kg-minimap-head">
        <span>Overview</span>
        <span>Map</span>
      </div>
      <div className="kg-minimap-body" onClick={onClick}>
        {data.nodes.map((n) => (
          <div
            key={n.id}
            className="kg-mini-node"
            style={{
              left: n.x * sx,
              top: n.y * sy,
              width: Math.max(3, n.w * sx),
              height: Math.max(2, 70 * sy),
              background: stateColorVar(n.state),
              opacity: selectedId === n.id ? 1 : 0.8,
              outline: selectedId === n.id ? '1px solid var(--kg-accent)' : 'none',
            }}
          />
        ))}

        {/* Viewport indicator */}
        <div
          className="kg-mini-vp"
          style={{
            left: (-view.x / view.k) * sx,
            top: (-view.y / view.k) * sy,
            width: (stageW / view.k) * sx,
            height: (stageH / view.k) * sy,
          }}
        />
      </div>
    </div>
  )
}
