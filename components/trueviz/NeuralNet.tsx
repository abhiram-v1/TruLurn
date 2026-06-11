'use client'

import React, { useMemo } from 'react'
import type { NeuralNetSpec } from '@/lib/trueviz/types'

// ── Layout constants ──────────────────────────────────────────────────────────

const LAYOUT = {
  R: 22,           // node radius
  LAYER_GAP: 160,  // horizontal distance between layer centers
  NODE_GAP: 56,    // vertical distance between node centers
  PAD_X: 80,       // padding to left/right edge from first/last layer center
  PAD_TOP: 20,     // space above title (or above content if no title)
  TITLE_H: 38,     // vertical space reserved for title + subtitle when present
  LABEL_H: 52,     // vertical space below last node center for layer label + activation
  PAD_BOTTOM: 18,  // padding below label area
  MAX_FULL: 7,     // layers with ≤ this many nodes show every node
  E_TOP: 3,        // nodes shown above the ellipsis when a layer is collapsed
  E_BTM: 2,        // nodes shown below the ellipsis when a layer is collapsed
} as const

const COMPACT = {
  R: 16,
  LAYER_GAP: 116,
  NODE_GAP: 42,
  PAD_X: 60,
  PAD_TOP: 18,
  TITLE_H: 34,
  LABEL_H: 44,
  PAD_BOTTOM: 14,
  MAX_FULL: 7,
  E_TOP: 3,
  E_BTM: 2,
} as const

// ── Color palette ─────────────────────────────────────────────────────────────
// Dark diagram card embedded in TruLurn's warm-cream lesson pages.

const PALETTE = {
  bg: '#0b0d16',
  border: '#1a1d2e',
  input:   { fill: '#0f766e', stroke: '#2dd4bf', text: '#2dd4bf' },   // teal
  hidden:  { fill: '#3730a3', stroke: '#818cf8', text: '#818cf8' },   // indigo
  output:  { fill: '#9a3412', stroke: '#ea580c', text: '#ea580c' },   // orange (echoes TruLurn accent)
  hl:      { fill: '#92400e', stroke: '#fbbf24', text: '#fbbf24' },   // amber highlight
  conn:       'rgba(255,255,255,0.065)',
  connHl:     '#fbbf24',
  titleText:  '#e2e8f0',
  subtitleText: '#64748b',
  labelText:  '#94a3b8',
  ellipsis:   '#475569',
} as const

type NodePalette = { fill: string; stroke: string; text: string }

function nodeColors(li: number, L: number, hl: boolean): NodePalette {
  if (hl) return PALETTE.hl
  if (li === 0) return PALETTE.input
  if (li === L - 1) return PALETTE.output
  return PALETTE.hidden
}

// ── Types used only inside this file ─────────────────────────────────────────

type VisNode = {
  li: number           // layer index
  ni: number           // original node index (-1 for ellipsis)
  x: number
  y: number
  isEllipsis: boolean
  label?: string
}

type Connection = {
  x1: number; y1: number
  x2: number; y2: number
  hl: boolean
}

type Layout = {
  svgW: number
  svgH: number
  contentCenterY: number
  labelY: number
  nodes: VisNode[]
  conns: Connection[]
  L: {
    R: number; LAYER_GAP: number; NODE_GAP: number; PAD_X: number
    PAD_TOP: number; TITLE_H: number; LABEL_H: number; PAD_BOTTOM: number
    MAX_FULL: number; E_TOP: number; E_BTM: number
  }
}

// ── Highlight helpers ─────────────────────────────────────────────────────────

function isHlNode(li: number, ni: number, spec: NeuralNetSpec): boolean {
  if (spec.layers[li]?.highlight) return true
  if (spec.highlightLayers?.includes(li)) return true
  if (spec.highlightNodes?.some(([a, b]) => a === li && b === ni)) return true
  if (spec.highlightPath?.nodes.some(([a, b]) => a === li && b === ni)) return true
  return false
}

function isHlConn(
  li1: number, ni1: number,
  li2: number, ni2: number,
  spec: NeuralNetSpec,
): boolean {
  const path = spec.highlightPath?.nodes
  if (!path) return false
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = path[i]
    const [c, d] = path[i + 1]
    if (a === li1 && b === ni1 && c === li2 && d === ni2) return true
  }
  return false
}

// ── Layout computation ────────────────────────────────────────────────────────

function buildLayout(spec: NeuralNetSpec): Layout {
  const isCompact = spec.compact ?? spec.layers.length > 7
  const lc = isCompact ? COMPACT : LAYOUT
  const { R, LAYER_GAP, NODE_GAP, PAD_X, PAD_TOP, TITLE_H, LABEL_H, PAD_BOTTOM, MAX_FULL, E_TOP, E_BTM } = lc

  const L = spec.layers.length
  const hasTitleArea = Boolean(spec.title || spec.subtitle)

  // Display count: how many vertical slots each layer occupies
  const displayCounts = spec.layers.map(l =>
    l.size <= MAX_FULL ? l.size : E_TOP + 1 + E_BTM,
  )
  const maxDC = Math.max(...displayCounts)

  // SVG dimensions
  const contentH = (maxDC - 1) * NODE_GAP
  const titleArea = hasTitleArea ? TITLE_H : PAD_TOP
  const svgH = PAD_TOP + titleArea + contentH + LABEL_H + PAD_BOTTOM
  const svgW = PAD_X * 2 + (L - 1) * LAYER_GAP

  // Vertical center of node grid
  const contentCenterY = PAD_TOP + titleArea + contentH / 2
  // Baseline for all layer labels (fixed, aligned to bottom of tallest layer)
  const labelY = PAD_TOP + titleArea + contentH + R + 14

  // Build visible node list
  const nodes: VisNode[] = []
  for (let li = 0; li < L; li++) {
    const layer = spec.layers[li]
    const dc = displayCounts[li]
    const collapsed = layer.size > MAX_FULL
    const x = PAD_X + li * LAYER_GAP
    const startY = contentCenterY - ((dc - 1) * NODE_GAP) / 2

    for (let di = 0; di < dc; di++) {
      const y = startY + di * NODE_GAP
      const isEllipsis = collapsed && di === E_TOP

      // Map display slot → original node index
      let ni: number
      if (!collapsed) {
        ni = di
      } else if (di < E_TOP) {
        ni = di
      } else if (isEllipsis) {
        ni = -1
      } else {
        ni = layer.size - E_BTM + (di - E_TOP - 1)
      }

      const label = ni >= 0 ? layer.nodeLabels?.[ni] : undefined
      nodes.push({ li, ni, x, y, isEllipsis, label })
    }
  }

  // Build connections
  const conns: Connection[] = []
  if (spec.connections !== 'none') {
    // Group real (non-ellipsis) nodes by layer
    const byLayer = new Map<number, VisNode[]>()
    for (const n of nodes) {
      if (n.isEllipsis) continue
      if (!byLayer.has(n.li)) byLayer.set(n.li, [])
      byLayer.get(n.li)!.push(n)
    }

    for (let li = 0; li < L - 1; li++) {
      const from = byLayer.get(li) ?? []
      const to = byLayer.get(li + 1) ?? []
      for (const fn of from) {
        for (const tn of to) {
          conns.push({
            x1: fn.x, y1: fn.y,
            x2: tn.x, y2: tn.y,
            hl: isHlConn(fn.li, fn.ni, tn.li, tn.ni, spec),
          })
        }
      }
    }
  }

  return { svgW, svgH, contentCenterY, labelY, nodes, conns, L: lc }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NeuralNet({ spec }: { spec: NeuralNetSpec }) {
  const layout = useMemo(() => buildLayout(spec), [spec])
  const { svgW, svgH, labelY, nodes, conns, L: lc } = layout
  const { R, PAD_X, LAYER_GAP, PAD_TOP, TITLE_H } = lc
  const layerCount = spec.layers.length
  const hasTitleArea = Boolean(spec.title || spec.subtitle)
  const titleBaseY = PAD_TOP + 16

  // Unique glow filter id — avoids conflicts if multiple diagrams on same page
  const filterId = `trueviz-glow-${spec.title?.replace(/\W/g, '') ?? 'nn'}`

  return (
    <div className="trueviz-wrap">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%"
        style={{ maxWidth: svgW, display: 'block', margin: '0 auto' }}
        role="img"
        aria-label={spec.title ?? 'Neural network diagram'}
      >
        <defs>
          <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
            <feFlood floodColor="#fbbf24" floodOpacity="0.55" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Card background */}
        <rect
          x={0} y={0} width={svgW} height={svgH}
          fill={PALETTE.bg}
          rx={10}
          stroke={PALETTE.border}
          strokeWidth={1}
        />

        {/* Title area */}
        {spec.title && (
          <text
            x={svgW / 2}
            y={titleBaseY}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            fill={PALETTE.titleText}
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          >
            {spec.title}
          </text>
        )}
        {spec.subtitle && (
          <text
            x={svgW / 2}
            y={titleBaseY + (spec.title ? 17 : 0)}
            textAnchor="middle"
            fontSize={11}
            fill={PALETTE.subtitleText}
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          >
            {spec.subtitle}
          </text>
        )}

        {/* Regular connections — drawn first, behind nodes */}
        {conns
          .filter(c => !c.hl)
          .map((c, i) => (
            <line
              key={`c-${i}`}
              x1={c.x1} y1={c.y1}
              x2={c.x2} y2={c.y2}
              stroke={PALETTE.conn}
              strokeWidth={0.9}
            />
          ))}

        {/* Highlighted connections — drawn above regular, below nodes */}
        {conns
          .filter(c => c.hl)
          .map((c, i) => (
            <line
              key={`ch-${i}`}
              x1={c.x1} y1={c.y1}
              x2={c.x2} y2={c.y2}
              stroke={PALETTE.connHl}
              strokeWidth={2}
              opacity={0.8}
              filter={`url(#${filterId})`}
            />
          ))}

        {/* Nodes */}
        {nodes.map((node, i) => {
          if (node.isEllipsis) {
            // Render three small dots
            return (
              <g key={`e-${i}`} aria-hidden="true">
                {([-6, 0, 6] as const).map(offset => (
                  <circle
                    key={offset}
                    cx={node.x + offset}
                    cy={node.y}
                    r={2.5}
                    fill={PALETTE.ellipsis}
                  />
                ))}
              </g>
            )
          }

          const hl = isHlNode(node.li, node.ni, spec)
          const colors = nodeColors(node.li, layerCount, hl)
          const labelFitsInside = node.label && node.label.length <= 4

          return (
            <g key={`n-${i}`}>
              {/* Glow ring for highlighted nodes */}
              {hl && (
                <circle
                  cx={node.x} cy={node.y}
                  r={R + 6}
                  fill="none"
                  stroke={colors.stroke}
                  strokeWidth={1}
                  opacity={0.3}
                  filter={`url(#${filterId})`}
                />
              )}

              {/* Node body */}
              <circle
                cx={node.x} cy={node.y}
                r={R}
                fill={colors.fill}
                fillOpacity={0.22}
                stroke={colors.stroke}
                strokeWidth={1.6}
              />

              {/* Short label inside the circle */}
              {labelFitsInside && (
                <text
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  fontWeight={500}
                  fill={colors.text}
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                >
                  {node.label}
                </text>
              )}

              {/* Longer label below the circle */}
              {node.label && !labelFitsInside && (
                <text
                  x={node.x}
                  y={node.y + R + 11}
                  textAnchor="middle"
                  fontSize={9}
                  fill={PALETTE.labelText}
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                >
                  {node.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Layer labels */}
        {spec.layers.map((layer, li) => {
          const x = PAD_X + li * LAYER_GAP
          const defaultLabel = li === 0
            ? 'Input'
            : li === layerCount - 1
              ? 'Output'
              : 'Hidden'
          const collapsed = layer.size > lc.MAX_FULL
          const displayLabel = collapsed
            ? `${layer.label ?? defaultLabel} (${layer.size})`
            : (layer.label ?? defaultLabel)

          return (
            <g key={`lbl-${li}`}>
              <text
                x={x}
                y={labelY}
                textAnchor="middle"
                fontSize={11}
                fontWeight={500}
                fill={PALETTE.labelText}
                fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              >
                {displayLabel}
              </text>
              {layer.activation && (
                <text
                  x={x}
                  y={labelY + 15}
                  textAnchor="middle"
                  fontSize={9.5}
                  fill={PALETTE.subtitleText}
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                >
                  {layer.activation}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
