'use client'

import { useId, useMemo } from 'react'
import type {
  CoordinateVector,
  CoordinateVectorsSpec,
  VectorTuple,
} from '@/lib/trueviz/types'

const WIDTH = 760
const HEIGHT = 390
const VECTOR_COLORS = ['#d66d4a', '#4f7df5', '#10b981', '#8b5cf6', '#f59e0b']

type ScreenPoint = { x: number; y: number }

function safeColor(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback
}

function tuple(values: VectorTuple | undefined, dimensions: 2 | 3): number[] {
  return values ? [...values] : Array.from({ length: dimensions }, () => 0)
}

function formatTuple(values: number[]) {
  return `(${values.map((value) => Number(value.toFixed(2))).join(', ')})`
}

function resolveExtent(spec: CoordinateVectorsSpec) {
  if (spec.extent) return Math.min(1000, spec.extent)
  const coordinates = [
    ...spec.vectors.flatMap((vector) => [
      ...tuple(vector.from, spec.dimensions),
      ...tuple(vector.to, spec.dimensions),
    ]),
    ...(spec.points ?? []).flatMap((point) => tuple(point.at, spec.dimensions)),
    1,
  ]
  return Math.max(1, Math.ceil(Math.max(...coordinates.map((value) => Math.abs(value))) * 1.2))
}

function gridStep(extent: number) {
  if (extent <= 6) return 1
  return Math.max(1, Math.ceil(extent / 5))
}

function vectorOpacity(vector: CoordinateVector) {
  if (vector.emphasis === 'muted') return 0.45
  if (vector.emphasis === 'secondary') return 0.72
  return 1
}

export function CoordinateVectors({ spec }: { spec: CoordinateVectorsSpec }) {
  const rawId = useId()
  const markerPrefix = `vector-arrow-${rawId.replace(/[^a-z0-9_-]/gi, '')}`
  const extent = useMemo(() => resolveExtent(spec), [spec])
  const dimensions = spec.dimensions
  const labels = spec.axisLabels ?? (dimensions === 3 ? ['x', 'y', 'z'] : ['x', 'y'])
  const step = gridStep(extent)

  const project = (values: number[]): ScreenPoint => {
    if (dimensions === 2) {
      const scale = Math.min(300 / (2 * extent), 610 / (2 * extent))
      return { x: WIDTH / 2 + values[0] * scale, y: 195 - values[1] * scale }
    }
    const scale = Math.min(260 / (2 * extent), 540 / (3.1 * extent))
    return {
      x: WIDTH / 2 + (values[0] - 0.58 * values[1]) * scale,
      y: 230 + (0.36 * values[1] - values[2]) * scale,
    }
  }

  const axis = (index: number, value: number) => {
    const values = Array.from({ length: dimensions }, () => 0)
    values[index] = value
    return project(values)
  }

  const ticks: number[] = []
  for (let value = -Math.floor(extent / step) * step; value <= extent; value += step) ticks.push(value)

  return (
    <figure className="coordinate-vectors-wrap">
      {(spec.title || spec.description) ? (
        <figcaption className="coordinate-vectors-heading">
          {spec.title ? <strong>{spec.title}</strong> : null}
          {spec.description ? <span>{spec.description}</span> : null}
        </figcaption>
      ) : null}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={spec.title ?? `${dimensions}D coordinate vector diagram`}
      >
        <defs>
          {spec.vectors.map((vector, index) => {
            const color = safeColor(vector.color, VECTOR_COLORS[index % VECTOR_COLORS.length])
            return (
              <marker
                id={`${markerPrefix}-${index}`}
                key={`${markerPrefix}-${index}`}
                markerWidth="9"
                markerHeight="9"
                refX="7.5"
                refY="4.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 9 4.5 L 0 9 z" fill={color} />
              </marker>
            )
          })}
        </defs>

        {spec.showGrid !== false && dimensions === 2 ? ticks.map((value) => {
          if (value === 0) return null
          const verticalStart = project([value, -extent])
          const verticalEnd = project([value, extent])
          const horizontalStart = project([-extent, value])
          const horizontalEnd = project([extent, value])
          return (
            <g className="coordinate-grid" key={`grid-${value}`}>
              <line x1={verticalStart.x} y1={verticalStart.y} x2={verticalEnd.x} y2={verticalEnd.y} />
              <line x1={horizontalStart.x} y1={horizontalStart.y} x2={horizontalEnd.x} y2={horizontalEnd.y} />
            </g>
          )
        }) : null}

        {spec.showGrid !== false && dimensions === 3 ? ticks.map((value) => {
          const xStart = project([-extent, value, 0])
          const xEnd = project([extent, value, 0])
          const yStart = project([value, -extent, 0])
          const yEnd = project([value, extent, 0])
          return (
            <g className="coordinate-grid coordinate-grid-3d" key={`plane-${value}`}>
              <line x1={xStart.x} y1={xStart.y} x2={xEnd.x} y2={xEnd.y} />
              <line x1={yStart.x} y1={yStart.y} x2={yEnd.x} y2={yEnd.y} />
            </g>
          )
        }) : null}

        {Array.from({ length: dimensions }, (_, index) => {
          const start = axis(index, -extent)
          const end = axis(index, extent)
          return (
            <g className="coordinate-axis" key={`axis-${index}`}>
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
              <text x={end.x + (index === 1 && dimensions === 3 ? -12 : 9)} y={end.y - 8}>{labels[index]}</text>
            </g>
          )
        })}

        {dimensions === 2 ? ticks.map((value) => {
          if (value === 0) return null
          const xTick = project([value, 0])
          const yTick = project([0, value])
          return (
            <g className="coordinate-tick" key={`tick-${value}`}>
              <line x1={xTick.x} y1={xTick.y - 4} x2={xTick.x} y2={xTick.y + 4} />
              <text x={xTick.x} y={xTick.y + 18}>{value}</text>
              <line x1={yTick.x - 4} y1={yTick.y} x2={yTick.x + 4} y2={yTick.y} />
              <text x={yTick.x - 11} y={yTick.y + 4}>{value}</text>
            </g>
          )
        }) : null}

        {(spec.points ?? []).map((point, index) => {
          const values = tuple(point.at, dimensions)
          const position = project(values)
          const color = safeColor(point.color, '#d66d4a')
          return (
            <g className="coordinate-point" key={`point-${index}`}>
              <circle cx={position.x} cy={position.y} r="5" fill={color} />
              {point.label ? <text x={position.x + 9} y={position.y - 8}>{point.label}</text> : null}
            </g>
          )
        })}

        {spec.vectors.map((vector, index) => {
          const from = tuple(vector.from, dimensions)
          const to = tuple(vector.to, dimensions)
          const start = project(from)
          const end = project(to)
          const color = safeColor(vector.color, VECTOR_COLORS[index % VECTOR_COLORS.length])
          const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
          const label = vector.label
            ? `${vector.label}${spec.showCoordinates === false ? '' : ` ${formatTuple(to)}`}`
            : spec.showCoordinates === false ? '' : formatTuple(to)
          return (
            <g
              className="coordinate-vector"
              key={`vector-${index}`}
              style={{ opacity: vectorOpacity(vector) }}
            >
              <circle cx={start.x} cy={start.y} r="4" fill={color} />
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={color}
                strokeDasharray={vector.dashed ? '8 7' : undefined}
                markerEnd={`url(#${markerPrefix}-${index})`}
              />
              {label ? (
                <g className="coordinate-vector-label">
                  <rect x={mid.x + 7} y={mid.y - 24} width={Math.max(42, label.length * 7.2 + 14)} height="25" rx="5" />
                  <text x={mid.x + 14} y={mid.y - 7} fill={color}>{label}</text>
                </g>
              ) : null}
            </g>
          )
        })}
      </svg>
      <div className="coordinate-vectors-note">
        <span>{dimensions}D Cartesian space</span>
        <span>{spec.vectors.length === 1 ? '1 vector' : `${spec.vectors.length} vectors`}</span>
      </div>
    </figure>
  )
}
