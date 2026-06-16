'use client'

import { useState, useEffect } from 'react'
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  ScatterChart, Scatter,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import type { DataChartSpec } from '@/lib/trueviz/chartSpec'

// ── Color palette ─────────────────────────────────────────────────────────────
// Chosen to be vibrant on both the warm light and dark themes.

const PALETTE = [
  '#4F7DF5',  // blue
  '#E07B56',  // coral (app accent)
  '#10B981',  // emerald
  '#8B5CF6',  // violet
  '#F59E0B',  // amber
  '#EC4899',  // pink
  '#06B6D4',  // cyan
  '#6B7280',  // neutral gray
]

function color(series: { color?: string } | undefined, index: number): string {
  return series?.color ?? PALETTE[index % PALETTE.length]
}

// ── Shared axis / grid style ──────────────────────────────────────────────────

const TICK = { fill: 'currentColor', fontSize: 13, opacity: 0.7 } as const
const AXIS_LINE = { stroke: 'currentColor', opacity: 0.12 } as const

function xLabel(label: string | undefined) {
  if (!label) return undefined
  return { value: label, position: 'insideBottom' as const, offset: -8, fill: 'currentColor', opacity: 0.85, fontSize: 14, fontWeight: 500 }
}

function yLabel(label: string | undefined) {
  if (!label) return undefined
  return { value: label, angle: -90, position: 'insideLeft' as const, dx: 4, style: { textAnchor: 'middle' as const }, fill: 'currentColor', opacity: 0.85, fontSize: 14, fontWeight: 500 }
}

// When a y-axis title is present, the rotated label needs room to the left of
// the tick numbers — otherwise it clips against the chart edge.
function leftMargin(spec: DataChartSpec) {
  return spec.yAxis?.label ? 28 : 8
}

// Bottom room for x-axis ticks plus an optional axis title. The legend is moved
// to the top (see renderers), so it no longer competes for this space.
function bottomMargin(spec: DataChartSpec) {
  return spec.xAxis?.label ? 40 : 20
}

function tooltipStyle() {
  return {
    contentStyle: {
      background: 'var(--color-surface-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      fontSize: '12px',
      color: 'var(--color-text-primary)',
      boxShadow: '0 4px 12px var(--shadow-color)',
    },
    labelStyle: { color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2 },
  }
}

const LEGEND_STYLE = { color: 'currentColor', opacity: 0.85, fontSize: 13, paddingBottom: 10 }

// ── Per-chart-type renderers ──────────────────────────────────────────────────

function BarRenderer({ spec, height, showGrid, showLegend }: RendererProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={spec.data} margin={{ top: 8, right: 20, left: leftMargin(spec), bottom: bottomMargin(spec) }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} vertical={false} />}
        <XAxis
          dataKey={spec.xAxis?.key}
          tick={TICK}
          axisLine={AXIS_LINE}
          tickLine={{ stroke: 'none' }}
          label={xLabel(spec.xAxis?.label)}
        />
        <YAxis
          tick={TICK}
          axisLine={{ stroke: 'none' }}
          tickLine={{ stroke: 'none' }}
          label={yLabel(spec.yAxis?.label)}
          domain={spec.yAxis?.domain}
        />
        <Tooltip {...tooltipStyle()} />
        {showLegend && <Legend verticalAlign="top" wrapperStyle={LEGEND_STYLE} />}
        {spec.series?.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            fill={color(s, i)}
            stackId={s.stackId}
            radius={[2, 2, 0, 0]}
            maxBarSize={64}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function LineRenderer({ spec, height, showGrid, showLegend }: RendererProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={spec.data} margin={{ top: 8, right: 20, left: leftMargin(spec), bottom: bottomMargin(spec) }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />}
        <XAxis
          dataKey={spec.xAxis?.key}
          tick={TICK}
          axisLine={AXIS_LINE}
          tickLine={{ stroke: 'none' }}
          label={xLabel(spec.xAxis?.label)}
        />
        <YAxis
          tick={TICK}
          axisLine={{ stroke: 'none' }}
          tickLine={{ stroke: 'none' }}
          label={yLabel(spec.yAxis?.label)}
          domain={spec.yAxis?.domain}
        />
        <Tooltip {...tooltipStyle()} />
        {showLegend && <Legend verticalAlign="top" wrapperStyle={LEGEND_STYLE} />}
        {spec.series?.map((s, i) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={color(s, i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function AreaRenderer({ spec, height, showGrid, showLegend }: RendererProps) {
  const fillOpacity = spec.config?.fillOpacity ?? 0.25
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={spec.data} margin={{ top: 8, right: 20, left: leftMargin(spec), bottom: bottomMargin(spec) }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />}
        <XAxis
          dataKey={spec.xAxis?.key}
          tick={TICK}
          axisLine={AXIS_LINE}
          tickLine={{ stroke: 'none' }}
          label={xLabel(spec.xAxis?.label)}
        />
        <YAxis
          tick={TICK}
          axisLine={{ stroke: 'none' }}
          tickLine={{ stroke: 'none' }}
          label={yLabel(spec.yAxis?.label)}
          domain={spec.yAxis?.domain}
        />
        <Tooltip {...tooltipStyle()} />
        {showLegend && <Legend verticalAlign="top" wrapperStyle={LEGEND_STYLE} />}
        {spec.series?.map((s, i) => {
          const c = color(s, i)
          return (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={c}
              fill={c}
              fillOpacity={fillOpacity}
              strokeWidth={2}
              stackId={s.stackId}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ScatterRenderer({ spec, height, showGrid }: RendererProps) {
  const xKey = spec.xAxis?.key ?? 'x'
  const yKey = spec.series?.[0]?.key ?? 'y'
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 20, left: leftMargin(spec), bottom: bottomMargin(spec) }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />}
        <XAxis
          type="number"
          dataKey={xKey}
          name={spec.xAxis?.label ?? xKey}
          tick={TICK}
          axisLine={AXIS_LINE}
          tickLine={{ stroke: 'none' }}
          label={xLabel(spec.xAxis?.label)}
        />
        <YAxis
          type="number"
          dataKey={yKey}
          name={spec.yAxis?.label ?? (spec.series?.[0]?.label ?? yKey)}
          tick={TICK}
          axisLine={{ stroke: 'none' }}
          tickLine={{ stroke: 'none' }}
          label={yLabel(spec.yAxis?.label)}
          domain={spec.yAxis?.domain}
        />
        <Tooltip
          {...tooltipStyle()}
          cursor={{ strokeDasharray: '3 3', stroke: 'currentColor', strokeOpacity: 0.3 }}
        />
        <Scatter
          name={spec.series?.[0]?.label ?? yKey}
          data={spec.data}
          fill={color(spec.series?.[0], 0)}
          opacity={0.72}
        />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

function PieRenderer({ spec, height, showLegend }: RendererProps) {
  const data = spec.data as Array<Record<string, unknown>>
  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          dataKey="value"
          nameKey="name"
          outerRadius="70%"
          paddingAngle={2}
          label={({ value }) => total > 0 ? `${((Number(value) / total) * 100).toFixed(0)}%` : ''}
          labelLine={false}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={(entry.color as string | undefined) ?? PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle()} />
        {(showLegend ?? true) && <Legend wrapperStyle={LEGEND_STYLE} />}
      </PieChart>
    </ResponsiveContainer>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type RendererProps = {
  spec: DataChartSpec
  height: number
  showGrid: boolean
  showLegend: boolean
}

export function DataChart({ spec }: { spec: DataChartSpec }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const height = Math.min(Math.max(spec.config?.height ?? 300, 80), 500)
  const showGrid = spec.config?.showGrid ?? true
  const showLegend = spec.config?.showLegend ?? ((spec.series?.length ?? 0) > 1)

  const rProps: RendererProps = { spec, height, showGrid, showLegend }

  return (
    <div className="chart-wrap">
      {spec.title && <div className="chart-title">{spec.title}</div>}
      {spec.description && <div className="chart-description">{spec.description}</div>}
      <div className="chart-body">
        {!mounted
          ? <div className="chart-skeleton" style={{ height }} aria-hidden="true" />
          : spec.chartType === 'bar' || spec.chartType === 'histogram'
            ? <BarRenderer {...rProps} />
            : spec.chartType === 'line'
              ? <LineRenderer {...rProps} />
              : spec.chartType === 'area'
                ? <AreaRenderer {...rProps} />
                : spec.chartType === 'scatter'
                  ? <ScatterRenderer {...rProps} />
                  : spec.chartType === 'pie'
                    ? <PieRenderer {...rProps} />
                    : <div className="trueviz-error">Unsupported chartType: {spec.chartType}</div>
        }
      </div>
    </div>
  )
}
