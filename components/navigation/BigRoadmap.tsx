'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Branch } from '@/types'
import {
  IconBrain,
  IconEye,
  IconNetwork,
  IconRobot,
  IconTargetArrow,
  IconChartDots3,
  IconBinaryTree,
  IconTopologyStar3,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'

/* ── icon per branch ── */
const branchIcons: Record<string, Icon> = {
  supervised: IconTargetArrow,
  unsupervised: IconEye,
  'self-supervised': IconBrain,
  reinforcement: IconRobot,
}

/* ── sub-topic labels per branch (the milestones the user asked for) ── */
const branchMilestones: Record<string, { label: string; icon: Icon }[]> = {
  supervised: [
    { label: 'Regression', icon: IconChartDots3 },
    { label: 'Classification', icon: IconBinaryTree },
  ],
  unsupervised: [
    { label: 'Clustering', icon: IconTopologyStar3 },
    { label: 'Dim. Reduction', icon: IconNetwork },
  ],
  'self-supervised': [
    { label: 'Pretext Tasks', icon: IconBrain },
    { label: 'Contrastive', icon: IconEye },
  ],
  reinforcement: [
    { label: 'Policy Methods', icon: IconRobot },
    { label: 'Value Methods', icon: IconTargetArrow },
  ],
}

/* ── state → color mapping ── */
function stateColor(state: string) {
  switch (state) {
    case 'in_progress': return { bg: '#FFF3E0', border: '#d36d4a', text: '#d36d4a', glow: 'rgba(211,109,74,0.25)' }
    case 'mastered':    return { bg: '#EAF3DE', border: '#3B6D11', text: '#3B6D11', glow: 'rgba(59,109,17,0.2)' }
    default:            return { bg: '#f4f4f5', border: '#d3d5d7', text: '#7a7a7a', glow: 'rgba(0,0,0,0.04)' }
  }
}

function stateLabel(state: string) {
  switch (state) {
    case 'in_progress': return 'In Progress'
    case 'mastered':    return 'Mastered'
    default:            return 'Not Started'
  }
}

/* ── The roadmap component ── */
export function BigRoadmap({ branches, courseId }: { branches: Branch[]; courseId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<Set<number>>(new Set())
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  /* stagger-reveal on mount */
  useEffect(() => {
    branches.forEach((_, i) => {
      setTimeout(() => setVisible((prev) => new Set(prev).add(i)), 220 + i * 180)
    })
  }, [branches])

  /* config */
  const nodeSpacing = 260
  const pathWidth = 700
  const svgHeight = branches.length * nodeSpacing + 80
  const centerX = pathWidth / 2

  /* node positions: zigzag left-right */
  const nodePositions = branches.map((_, i) => ({
    x: i % 2 === 0 ? centerX - 120 : centerX + 120,
    y: 80 + i * nodeSpacing,
  }))

  /* build the winding SVG path */
  function buildPath() {
    if (nodePositions.length < 2) return ''
    let d = `M ${nodePositions[0].x} ${nodePositions[0].y}`
    for (let i = 1; i < nodePositions.length; i++) {
      const prev = nodePositions[i - 1]
      const curr = nodePositions[i]
      const midY = (prev.y + curr.y) / 2
      d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`
    }
    return d
  }

  return (
    <div className="dynamic-roadmap" ref={containerRef}>
      {/* Background SVG winding path */}
      <svg
        className="roadmap-svg"
        viewBox={`0 0 ${pathWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          {/* Gradient for the trail */}
          <linearGradient id="roadmap-trail-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d36d4a" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#d36d4a" stopOpacity="0.08" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="roadmap-glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Animated dash */}
          <linearGradient id="dot-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d36d4a" stopOpacity="0" />
            <stop offset="50%" stopColor="#d36d4a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#d36d4a" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The winding path – background track */}
        <path
          d={buildPath()}
          fill="none"
          stroke="#d3d5d7"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.5"
        />

        {/* The winding path – accent overlay (animated dash) */}
        <path
          className="roadmap-path-animated"
          d={buildPath()}
          fill="none"
          stroke="url(#roadmap-trail-grad)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="12 8"
        />

        {/* Horizontal connectors from node to card edge */}
        {nodePositions.map((pos, i) => {
          const isLeft = i % 2 === 0
          const nodeEdgeX = isLeft ? pos.x + 18 : pos.x - 18
          const cardEdgeX = isLeft ? centerX - 60 : centerX + 60
          return (
            <line
              key={`hconn-${i}`}
              x1={nodeEdgeX}
              y1={pos.y}
              x2={cardEdgeX}
              y2={pos.y}
              stroke="#d3d5d7"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.8"
            />
          )
        })}

        {/* Node circles */}
        {nodePositions.map((pos, i) => {
          const colors = stateColor(branches[i].state)
          return (
            <g key={`connector-${i}`}>
              {/* Glow circle */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={hoveredIndex === i ? 28 : 22}
                fill={colors.glow}
                className="roadmap-node-glow"
              />
              {/* Outer ring */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={20}
                fill={colors.bg}
                stroke={colors.border}
                strokeWidth="2"
                className={branches[i].state === 'in_progress' ? 'roadmap-pulse-dot' : 'roadmap-node-ring'}
              />
              {/* Step number inside circle */}
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fill={colors.text}
                fontSize="10"
                fontWeight="500"
                fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              >
                {String(i + 1).padStart(2, '0')}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Milestone cards overlaid on top of SVG */}
      <div className="roadmap-cards-layer" style={{ height: svgHeight }}>
        {branches.map((branch, i) => {
          const pos = nodePositions[i]
          const isLeft = i % 2 === 0
          const colors = stateColor(branch.state)
          const Icon = branchIcons[branch.id] ?? IconBrain
          const milestones = branchMilestones[branch.id] ?? []
          const isVisible = visible.has(i)
          const isHovered = hoveredIndex === i
          const progressPct = branch.topic_count > 0 ? (branch.mastered_count / branch.topic_count) * 100 : 0

          const dest = branch.active_topic_id
            ? `/learn/${courseId}/${encodeURIComponent(branch.active_topic_id)}`
            : `/course/${courseId}`

          return (
            <Link
              key={branch.id}
              href={dest}
              data-state={branch.state}
              className={`roadmap-card ${isLeft ? 'card-left' : 'card-right'} ${isVisible ? 'card-visible' : ''} ${isHovered ? 'card-hovered' : ''}`}
              style={{
                top: pos.y - 60,
                ...(isLeft
                  ? { right: `calc(50% + 60px)` }
                  : { left: `calc(50% + 60px)` }),
              }}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Card header */}
              <div className="roadmap-card-header">
                <div className="roadmap-card-icon" style={{ background: colors.bg, color: colors.text, borderColor: `${colors.border}66` }}>
                  <Icon size={19} stroke={1.6} />
                </div>
                <div className="roadmap-card-titles">
                  <h2 className="roadmap-card-title">{branch.title}</h2>
                  <span className="roadmap-card-state" style={{ color: colors.text, background: colors.bg, borderColor: colors.border }}>
                    <span className="state-dot" style={{ background: colors.border }} />
                    {stateLabel(branch.state)}
                  </span>
                </div>
              </div>

              {/* Description */}
              <p className="roadmap-card-desc">{branch.description}</p>

              {/* Milestone pills */}
              <div className="roadmap-milestones">
                {milestones.map((ms) => {
                  const MsIcon = ms.icon
                  return (
                    <span key={ms.label} className="roadmap-milestone-pill">
                      <MsIcon size={12} stroke={1.6} />
                      {ms.label}
                    </span>
                  )
                })}
              </div>

              {/* Progress bar */}
              <div className="roadmap-card-progress-row">
                <div className="roadmap-card-progress-track">
                  <div
                    className="roadmap-card-progress-fill"
                    style={{
                      width: `${progressPct}%`,
                      background: colors.border,
                    }}
                  />
                </div>
                <span className="roadmap-card-stats">
                  {branch.mastered_count}/{branch.topic_count} topics
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
