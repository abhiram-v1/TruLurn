'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { GraphData, GraphNode } from '@/lib/graph/types'
import { BackButton } from '@/components/navigation/BackButton'
import { KnowledgeGraph } from './KnowledgeGraph'
import { GraphDetailPanel } from './GraphDetailPanel'
import { GraphSidebar } from './GraphSidebar'
import { GraphMinimap } from './GraphMinimap'

// ── Filter state ─────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  showLocked: true,
  showWeak: true,
  showCritical: true,
  showRegions: false,
  showRecommended: true,
  focusMode: false,
}
type Filters = typeof DEFAULT_FILTERS

// ── Main client component ────────────────────────────────────────────────────

export function GraphClient({ courseId }: { courseId: string }) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [activeBranch, setActiveBranch] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [view, setView] = useState({ x: 24, y: 18, k: 0.84 })

  const searchRef = useRef<HTMLInputElement>(null)

  // ── Fetch graph data ──────────────────────────────────────────────────────
  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch(`/api/graph/${courseId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to load graph.')
        return
      }
      const data: GraphData = await res.json()
      setGraphData(data)
      // Auto-select the current / active topic on first load
      const current = data.nodes.find((n) => n.current) ?? data.nodes.find((n) => n.state === 'active')
      if (current) setSelectedId(current.id)
    } catch (e) {
      setError('Network error loading graph.')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => { fetchGraph() }, [fetchGraph])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Filter toggle ─────────────────────────────────────────────────────────
  function toggleFilter(key: keyof Filters) {
    setFilters((f) => ({ ...f, [key]: !f[key] }))
  }

  // ── Derived data (filter + search) ───────────────────────────────────────
  const visibleData = useMemo((): GraphData | null => {
    if (!graphData) return null
    let nodes = graphData.nodes

    if (!filters.showLocked) nodes = nodes.filter((n) => n.state !== 'locked')
    if (activeBranch !== 'all') nodes = nodes.filter((n) => n.branch === activeBranch)

    if (search.trim()) {
      const q = search.toLowerCase()
      const matched = new Set(
        graphData.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id),
      )
      nodes = nodes.map((n) => ({ ...n, _dim: !matched.has(n.id) } as GraphNode))
    }

    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = graphData.edges.filter(
      (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
    )

    return { ...graphData, nodes, edges }
  }, [graphData, filters.showLocked, activeBranch, search])

  // ── Selected node ─────────────────────────────────────────────────────────
  const selectedNode = useMemo(
    () => (selectedId && graphData ? graphData.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, graphData],
  )

  const focusId = filters.focusMode && selectedId ? selectedId : null

  // ── States ────────────────────────────────────────────────────────────────
  function centerNode(node: GraphNode | null = selectedNode) {
    if (!node) return
    const mainW = Math.max(520, window.innerWidth - 232 - 320)
    const mainH = Math.max(420, window.innerHeight - 52)
    const nextK = Math.max(0.78, Math.min(1.08, view.k))
    setView({
      k: nextK,
      x: mainW / 2 - (node.x + node.w / 2) * nextK,
      y: mainH / 2 - (node.y + 48) * nextK,
    })
  }

  if (loading) {
    return (
      <div className="kg-loading">
        <div className="kg-loading-inner">Loading knowledge graph...</div>
      </div>
    )
  }

  if (error || !visibleData) {
    return (
      <div className="kg-loading">
        <div className="kg-loading-inner" style={{ color: 'var(--kg-unstable-ink)' }}>
          {error ?? 'Could not load graph.'}
        </div>
      </div>
    )
  }

  const { course } = visibleData
  const total = course.topicCount || 1
  const seg = (n: number) => `${(n / total) * 100}%`

  return (
    <div className="kg-app">
      {/* ── Topbar ── */}
      <header className="kg-topbar">
        <div className="kg-topbar-brand">
          <BackButton fallbackHref={`/course/${courseId}`} />
          <span className="kg-brand-mark">T</span>
          <span className="kg-brand-name">TruLurn</span>
        </div>

        <div className="kg-topbar-center">
          <div className="kg-crumbs">
            <Link href="/">Courses</Link>
            <span className="sep">/</span>
            <Link href={`/course/${courseId}`}><strong>{course.title}</strong></Link>
            <span className="sep">/</span>
            <span>Knowledge graph</span>
          </div>

          <div className="kg-topbar-progress">
            <div className="kg-progress-bar">
              <span className="pb-mastered"   style={{ width: seg(course.mastered) }} />
              <span className="pb-functional" style={{ width: seg(course.functional) }} />
              <span className="pb-partial"    style={{ width: seg(course.partial) }} />
              <span className="pb-unstable"   style={{ width: seg(course.unstable) }} />
            </div>
            <div className="kg-progress-num">
              Learning signals by color
            </div>
          </div>
        </div>

        <div className="kg-topbar-right">
          <div className="kg-search">
            <span style={{ color: 'var(--kg-muted)', fontSize: 12 }}>⌕</span>
            <input
              ref={searchRef}
              placeholder="Search concepts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>⌘K</kbd>
          </div>
          <button className="kg-tb-btn" type="button" onClick={() => centerNode(selectedNode)} disabled={!selectedNode}>
            Center
          </button>
          <Link className="kg-tb-btn" href={`/course/${courseId}`}>Atlas</Link>
          {selectedNode && selectedNode.state !== 'locked' && (
            <Link
              className="kg-tb-btn accent"
              href={`/learn/${courseId}/${encodeURIComponent(selectedNode.id)}`}
            >
              <span className="dot" />
              {selectedNode.state === 'active' ? 'Continue study' : 'Open topic'}
            </Link>
          )}
        </div>
      </header>

      {/* ── Sidebar ── */}
      <GraphSidebar
        data={visibleData}
        activeBranch={activeBranch}
        setActiveBranch={setActiveBranch}
        filters={filters}
        onToggle={toggleFilter}
      />

      {/* ── Main canvas ── */}
      <main className="kg-main">
        <KnowledgeGraph
          data={visibleData}
          selectedId={selectedId}
          focusId={focusId}
          onSelect={setSelectedId}
          hoverId={hoverId}
          setHoverId={setHoverId}
          showCritical={filters.showCritical}
          showRegions={filters.showRegions}
          showRecommended={filters.showRecommended}
          showWeak={filters.showWeak}
          showLocked={filters.showLocked}
          view={view}
          setView={setView}
        />

        {/* Zoom controls */}
        <div className="kg-canvas-overlay kg-zoom-cluster">
          <div className="kg-zoom-pill">
            <button onClick={() => setView((v) => ({ ...v, k: Math.min(2, v.k + 0.1) }))}>+</button>
            <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k - 0.1) }))}>−</button>
            <button onClick={() => centerNode(selectedNode)} title="Center selected">◎</button>
            <button onClick={() => setView({ x: 24, y: 18, k: 0.84 })} title="Reset">↺</button>
          </div>
          <div className="kg-zoom-value">Zoom</div>
        </div>

        {/* Legend */}
        <div className="kg-canvas-overlay kg-legend-card">
          {[
            ['mastered', 'Mastered'],
            ['functional', 'Functional'],
            ['partial', 'Developing'],
            ['unstable', 'Review'],
            ['locked', 'Locked'],
          ].map(([s, label]) => (
            <span key={s}>
              <span className="kg-pip" style={{ background: `var(--kg-${s === 'locked' ? 'locked-line' : s + '-dot'})` }} />
              {label}
            </span>
          ))}
        </div>

        {/* Focus mode banner */}
        {focusId && selectedNode && (
          <div className="kg-canvas-overlay kg-focus-banner">
            <span className="dot" />
            Focus · {selectedNode.title} and its 1-hop neighbours
            <button onClick={() => toggleFilter('focusMode')}>Exit</button>
          </div>
        )}

        {/* Minimap */}
        <GraphMinimap data={visibleData} selectedId={selectedId} view={view} setView={setView} />
      </main>

      {/* ── Right detail panel ── */}
      <GraphDetailPanel
        node={selectedNode}
        data={visibleData}
        courseId={courseId}
        onSelect={setSelectedId}
        focusMode={filters.focusMode}
        onToggleFocus={() => toggleFilter('focusMode')}
      />
    </div>
  )
}
