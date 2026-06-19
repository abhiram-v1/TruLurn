'use client'

import * as Plot from '@observablehq/plot'
import { useEffect, useRef, useState } from 'react'
import type { DataChartSpec } from '@/lib/trueviz/chartSpec'
import { chartSeriesColors } from '@/lib/trueviz/palette'

type LongDatum = {
  x: unknown
  value: number
  series: string
}

function seriesLabel(spec: DataChartSpec, index: number) {
  const series = spec.series?.[index]
  return series?.label ?? series?.key ?? `Series ${index + 1}`
}

function toLongData(spec: DataChartSpec): LongDatum[] {
  const xKey = spec.xAxis?.key ?? 'x'
  return (spec.series ?? []).flatMap((series, seriesIndex) =>
    spec.data
      .map((row) => ({
        x: row[xKey],
        value: Number(row[series.key]),
        series: seriesLabel(spec, seriesIndex),
      }))
      .filter((datum) => Number.isFinite(datum.value)),
  )
}

function lastDatumPerSeries(data: LongDatum[]) {
  const last = new Map<string, LongDatum>()
  data.forEach((datum) => last.set(datum.series, datum))
  return [...last.values()]
}

function chartMargins(spec: DataChartSpec, showDirectLabels: boolean) {
  return {
    marginTop: 18,
    marginRight: showDirectLabels ? 118 : 28,
    marginBottom: spec.xAxis?.label ? 58 : 42,
    marginLeft: spec.yAxis?.label ? 76 : 56,
  }
}

function resolvedYDomain(spec: DataChartSpec, data: LongDatum[]) {
  const requested = spec.yAxis?.domain
  if (!requested) return undefined
  const values = data.map((datum) => datum.value).filter(Number.isFinite)
  const dataMin = values.length ? Math.min(...values) : 0
  const dataMax = values.length ? Math.max(...values) : 1
  const lower = requested[0] === 'auto' ? Math.min(0, dataMin) : requested[0]
  const upper = requested[1] === 'auto'
    ? dataMax + Math.max(Math.abs(dataMax - Number(lower)), 1) * 0.06
    : requested[1]
  return [lower, upper] as [number, number]
}

function buildPlot(spec: DataChartSpec, width: number, height: number, showGrid: boolean) {
  const labels = (spec.series ?? []).map((_, index) => seriesLabel(spec, index))
  const colors = chartSeriesColors(Math.max(labels.length, spec.data.length))
  const longData = toLongData(spec)
  const showDirectLabels = width >= 620 && labels.length > 0 && labels.length <= 4
  const marks: Plot.Markish[] = []

  if (showGrid && spec.chartType !== 'pie') {
    marks.push(Plot.gridY({ stroke: 'currentColor', strokeOpacity: 0.1 }))
  }

  if (spec.chartType !== 'pie') {
    marks.push(Plot.ruleY([0], { stroke: 'currentColor', strokeOpacity: 0.28 }))
  }

  if (spec.chartType === 'line') {
    marks.push(
      Plot.lineY(longData, {
        x: 'x',
        y: 'value',
        stroke: 'series',
        strokeWidth: 2.25,
        marker: true,
        tip: true,
      }),
    )
    if (showDirectLabels) {
      marks.push(
        Plot.text(lastDatumPerSeries(longData), {
          x: 'x',
          y: 'value',
          text: 'series',
          fill: 'series',
          dx: 9,
          textAnchor: 'start',
          fontWeight: 650,
        }),
      )
    }
  } else if (spec.chartType === 'area') {
    marks.push(
      Plot.areaY(longData, {
        x: 'x',
        y: 'value',
        fill: 'series',
        fillOpacity: spec.config?.fillOpacity ?? 0.18,
        curve: 'monotone-x',
        tip: true,
      }),
      Plot.lineY(longData, {
        x: 'x',
        y: 'value',
        stroke: 'series',
        strokeWidth: 2,
      }),
    )
  } else if (spec.chartType === 'scatter' || spec.chartType === 'bubble') {
    const xKey = spec.xAxis?.key ?? 'x'
    const yKey = spec.series?.[0]?.key ?? 'y'
    const sizeKey = spec.config?.bubbleSizeKey ?? 'z'
    marks.push(
      Plot.dot(spec.data, {
        x: xKey,
        y: yKey,
        r: spec.chartType === 'bubble' ? sizeKey : 4.5,
        fill: colors[0],
        fillOpacity: 0.72,
        stroke: 'var(--color-bg-primary)',
        strokeWidth: 1,
        tip: true,
      }),
    )
  } else if (spec.chartType === 'pie') {
    marks.push(
      Plot.waffleY(spec.data, {
        y: 'value',
        fill: 'name',
        tip: true,
        rx: 1.5,
      }),
    )
  } else {
    marks.push(
      Plot.barY(longData, {
        x: 'x',
        y: 'value',
        fill: 'series',
        inset: 1.5,
        rx: 2,
        tip: true,
      }),
    )
  }

  const { marginTop, marginRight, marginBottom, marginLeft } = chartMargins(spec, showDirectLabels)
  return Plot.plot({
    width,
    height,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    style: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      fontFamily: 'inherit',
      fontSize: '12px',
      overflow: 'visible',
    },
    x: spec.chartType === 'pie'
      ? undefined
      : {
          label: spec.xAxis?.label,
          labelAnchor: 'center',
          labelArrow: 'none',
          tickSize: 0,
          nice: true,
        },
    y: spec.chartType === 'pie'
      ? undefined
      : {
          label: spec.yAxis?.label,
          labelAnchor: 'center',
          labelArrow: 'none',
          domain: resolvedYDomain(spec, longData),
          tickSize: 0,
          nice: spec.yAxis?.domain ? false : true,
        },
    color: labels.length || spec.chartType === 'pie'
      ? {
          domain: spec.chartType === 'pie'
            ? spec.data.map((datum) => String(datum.name))
            : labels,
          range: colors,
          legend: false,
        }
      : undefined,
    marks,
  })
}

export function DataChart({ spec }: { spec: DataChartSpec }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const height = Math.min(Math.max(spec.config?.height ?? 320, 180), 500)
  const showGrid = spec.config?.showGrid ?? true
  const showLegend = spec.config?.showLegend ?? ((spec.series?.length ?? 0) > 1)
  const legendLabels = spec.chartType === 'pie'
    ? spec.data.map((datum) => String(datum.name))
    : (spec.series ?? []).map((_, index) => seriesLabel(spec, index))
  const legendColors = chartSeriesColors(legendLabels.length)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let chart: HTMLElement | SVGSVGElement | null = null
    const render = () => {
      const width = Math.max(320, Math.floor(host.clientWidth))
      if (chart?.parentNode === host) chart.remove()
      chart = buildPlot(spec, width, height, showGrid)
      chart.classList.add('trulurn-plot')
      host.replaceChildren(chart)
      setReady(true)
    }

    render()
    const observer = new ResizeObserver(render)
    observer.observe(host)
    return () => {
      observer.disconnect()
      if (chart?.parentNode === host) chart.remove()
    }
  }, [spec, height, showGrid])

  return (
    <figure className="chart-wrap">
      <figcaption className="chart-heading">
        {spec.title ? <strong className="chart-title">{spec.title}</strong> : null}
        {spec.description ? <span className="chart-description">{spec.description}</span> : null}
      </figcaption>
      {showLegend && legendLabels.length > 1 ? (
        <div className="chart-legend" aria-label="Chart legend">
          {legendLabels.map((label, index) => (
            <span key={`${label}-${index}`}>
              <i style={{ background: legendColors[index] }} />
              {label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="chart-body">
        <div className="chart-plot-host" ref={hostRef} />
        {!ready ? <div className="chart-skeleton" style={{ height }} aria-hidden="true" /> : null}
      </div>
      <div className="chart-figure-note">
        <span>TruLurn figure</span>
        <span>{spec.chartType === 'pie' ? 'proportion study' : `${spec.chartType} study`}</span>
      </div>
    </figure>
  )
}
