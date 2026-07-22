'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { GraphData, GraphNode } from '@/lib/graph/types'
import { requiredUnmetPath } from '@/lib/graph/edges'
import { BackButton } from '@/components/navigation/BackButton'
import { KnowledgeGraph } from './KnowledgeGraph'
import { GraphDetailPanel } from './GraphDetailPanel'
import { GraphSidebar } from './GraphSidebar'
import { GraphMinimap } from './GraphMinimap'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'

// ── Filter state ─────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  showLocked: true,
  showCritical: true,
  showRegions: true,   // branch swim-lane bands on by default
  showRecommended: false,
  showSemantic: false,
  showAllConnections: false,
  focusMode: false,
}
type Filters = typeof DEFAULT_FILTERS

// ── Main client component ────────────────────────────────────────────────────

function overviewView(graph: GraphData, panelW = 0) {
  const availableHeight = Math.max(420, window.innerHeight - 52)
  const availableWidth = Math.max(520, window.innerWidth - 232 - panelW)
  const scale = Math.min(
    0.78,
    Math.max(0.18, (availableHeight - 56) / Math.max(graph.canvasH, 1)),
  )
  return {
    x: Math.max(24, Math.min(54, (availableWidth - graph.canvasW * scale) / 2)),
    y: Math.max(24, (availableHeight - graph.canvasH * scale) / 2),
    k: scale,
  }
}

export function GraphClient({ courseId }: { courseId: string }) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Detail panel collapse — the panel only exists when a node is selected,
  // and even then the learner can tuck it away to give the graph full width.
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [activeBranch, setActiveBranch] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [view, setView] = useState({ x: 40, y: 30, k: 0.6 }) // start at section view (doc default)
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set())

  // Personal knowledge view (default) vs the full AI reference map.
  const [graphView, setGraphView] = useState<'knowledge' | 'reference'>('knowledge')
  // Connection mode: the node a new learner-made connection starts from.
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [connectionNote, setConnectionNote] = useState('')
  const [connectBusy, setConnectBusy] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  // ── Fetch graph data ──────────────────────────────────────────────────────
  const fetchGraph = useCallback(async (mode: 'knowledge' | 'reference', refit = true) => {
    try {
      const res = await fetch(`/api/graph/${courseId}?view=${mode}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to load graph.')
        return
      }
      const data: GraphData = await res.json()
      setGraphData(data)
      if (refit) {
        // No auto-select: the graph loads clean, and the detail panel only
        // appears when the learner clicks a node.
        setView(overviewView(data))
      }
    } catch (e) {
      setError('Network error loading graph.')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => { fetchGraph(graphView) }, [fetchGraph, graphView])

  // ── Learner-made connections ──────────────────────────────────────────────
  async function createConnection(fromId: string, toId: string) {
    if (connectBusy) return
    setConnectBusy(true)
    try {
      const res = await fetch(`/api/graph/${courseId}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromTopicId: fromId, toTopicId: toId, note: connectionNote }),
      })
      if (res.ok) {
        setConnectingFrom(null)
        setConnectionNote('')
        await fetchGraph(graphView, false) // keep the current pan/zoom
      }
    } finally {
      setConnectBusy(false)
    }
  }

  async function deleteConnection(connectionId: string) {
    const res = await fetch(`/api/graph/${courseId}/connections?id=${encodeURIComponent(connectionId)}`, {
      method: 'DELETE',
    })
    if (res.ok) await fetchGraph(graphView, false)
  }

  // In connect mode, clicking a second node creates the link instead of selecting.
  function handleSelect(id: string) {
    if (connectingFrom && id !== connectingFrom) {
      createConnection(connectingFrom, id)
      return
    }
    setSelectedId(id)
    setPanelCollapsed(false) // clicking a node always brings the panel back
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setConnectingFrom(null)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Filter toggle ─────────────────────────────────────────────────────────
  function toggleFilter(key: keyof Filters) {
    setFilters((f) => ({ ...f, [key]: !f[key] }))
  }

  // ── Branch collapse ───────────────────────────────────────────────────────
  function toggleBranch(branchId: string) {
    setCollapsedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(branchId)) next.delete(branchId)
      else next.add(branchId)
      return next
    })
  }

  // ── Derived data (filter + search) ───────────────────────────────────────
  const visibleData = useMemo((): GraphData | null => {
    if (!graphData) return null
    let nodes = graphData.nodes

    if (!filters.showLocked) nodes = nodes.filter((n) => n.state !== 'locked')
    if (activeBranch !== 'all') nodes = nodes.filter((n) => n.branch === activeBranch)
    if (collapsedBranches.size > 0) nodes = nodes.filter((n) => !collapsedBranches.has(n.branch))

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

    // Filter branch boxes to the active branch (collapsed boxes still render)
    let boxes = graphData.boxes
    if (activeBranch !== 'all') boxes = boxes.filter((b) => b.family === activeBranch)

    return { ...graphData, nodes, edges, boxes }
  }, [graphData, filters.showLocked, activeBranch, search, collapsedBranches])

  // ── Selected node ─────────────────────────────────────────────────────────
  const selectedNode = useMemo(
    () => (selectedId && graphData ? graphData.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, graphData],
  )

  const focusId = filters.focusMode && selectedId ? selectedId : null

  // ── Critical path — the exact unmet hard-prerequisite chain ────────────────
  // Highlights only the hard-prerequisite chain still blocking a selected
  // locked topic, stopping at the nearest mastered/functional ancestor. A
  // `sequence` edge (study order) is never part of this chain — only a real
  // "must understand first" dependency is (see lib/graph/edges.ts; this used
  // to also walk sequence edges, inflating the highlight with topics that
  // merely come earlier, not topics that are actually blocking).
  const criticalPath = useMemo((): { nodes: Set<string>; edges: Set<string> } => {
    const empty = { nodes: new Set<string>(), edges: new Set<string>() }
    if (!graphData || !selectedNode?.teachable || selectedNode.state !== 'locked') return empty

    const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]))
    return requiredUnmetPath({
      targetId: selectedNode.id,
      edges: graphData.edges,
      isSatisfied: (id) => {
        const state = nodeById.get(id)?.state
        return state === 'mastered' || state === 'functional'
      },
    })
  }, [graphData, selectedNode])

  // Panel is visible only when a node is selected and it isn't collapsed.
  const panelOpen = Boolean(selectedNode) && !panelCollapsed

  // ── States ────────────────────────────────────────────────────────────────
  function centerNode(node: GraphNode | null = selectedNode) {
    if (!node) return
    const mainW = Math.max(520, window.innerWidth - 232 - (panelOpen ? 320 : 0))
    const mainH = Math.max(420, window.innerHeight - 52)
    const nextK = Math.max(0.55, Math.min(1.3, view.k))
    // node.x / node.y are TOP-LEFT; centre on the card's middle
    const cx = node.x + node.w / 2
    const cy = node.y + node.h / 2
    setView({
      k: nextK,
      x: mainW / 2 - cx * nextK,
      y: mainH / 2 - cy * nextK,
    })
  }

  if (loading) {
    return (
      <div className="kg-loading">
        <div className="kg-loading-stage" aria-hidden>
          <div className="kg-skel-box">
            <span className="kg-skel-line w40" />
            <div className="kg-skel-cards">
              <span className="kg-skel-card" />
              <span className="kg-skel-card" />
              <span className="kg-skel-card" />
            </div>
          </div>
          <div className="kg-skel-box late">
            <span className="kg-skel-line w55" />
            <div className="kg-skel-cards">
              <span className="kg-skel-card" />
              <span className="kg-skel-card" />
            </div>
          </div>
        </div>
        <div className="kg-loading-inner">Laying out your knowledge atlas…</div>
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
  const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)

  return (
    <div className={`kg-app${graphView === 'knowledge' ? ' knowledge-view' : ''}`}>
      {/* ── Topbar ── */}
      <header className="kg-topbar">
        <div className="kg-topbar-brand">
          <BackButton fallbackHref={`/course/${courseId}`} />
          <Link className="brand" href="/" style={{ display: 'flex', alignItems: 'center', gap: '7px', textDecoration: 'none' }}>
            <TruLurnLogo size={22} />
            <span className="kg-brand-name">TruLurn</span>
          </Link>
        </div>

        <div className="kg-topbar-center">
          <div className="kg-crumbs">
            <Link href="/">Courses</Link>
            <span className="sep">/</span>
            <Link href={`/course/${courseId}`}><strong>{course.title}</strong></Link>
            <span className="sep">/</span>
            <span>{graphView === 'knowledge' ? 'My knowledge' : 'Reference map'}</span>
          </div>

          <div className="kg-view-toggle" role="radiogroup" aria-label="Graph view">
            <button
              type="button"
              role="radio"
              aria-checked={graphView === 'knowledge'}
              className={graphView === 'knowledge' ? 'active' : ''}
              onClick={() => { setConnectingFrom(null); setGraphView('knowledge') }}
              title="Only what you've learned, what you're learning, and the connections you made"
            >
              My knowledge
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={graphView === 'reference'}
              className={graphView === 'reference' ? 'active' : ''}
              onClick={() => { setConnectingFrom(null); setGraphView('reference') }}
              title="The full course map — prerequisites and suggested topics, as guidance"
            >
              Reference
            </button>
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
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </div>
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
          onSelect={handleSelect}
          hoverId={hoverId}
          setHoverId={setHoverId}
          showCritical={filters.showCritical}
          showRegions={filters.showRegions}
          showRecommended={filters.showRecommended}
          showSemantic={filters.showSemantic}
          showAllConnections={filters.showAllConnections}
          showLocked={filters.showLocked}
          view={view}
          setView={setView}
          criticalPathNodes={criticalPath.nodes}
          criticalPathEdges={criticalPath.edges}
          collapsedBranches={collapsedBranches}
          onToggleBranch={toggleBranch}
        />

        {/* Connect mode bar — pick the second concept, optionally annotate the link */}
        {connectingFrom && (
          <div className="kg-canvas-overlay kg-connect-bar">
            <span className="kg-connect-label">
              Linking <strong>{graphData?.nodes.find((n) => n.id === connectingFrom)?.title ?? 'concept'}</strong>
              {' '}— click another concept to connect
            </span>
            <input
              className="kg-connect-note"
              placeholder="Why are these connected? (optional)"
              value={connectionNote}
              maxLength={280}
              onChange={(e) => setConnectionNote(e.target.value)}
            />
            <button className="kg-connect-cancel" type="button" onClick={() => setConnectingFrom(null)} disabled={connectBusy}>
              {connectBusy ? 'Linking…' : 'Cancel'}
            </button>
          </div>
        )}

        {/* Empty state — knowledge view before any learning has happened */}
        {visibleData.nodes.length === 0 && graphView === 'knowledge' && graphData?.nodes.length === 0 ? (
          <div className="kg-canvas-overlay kg-empty-canvas">
            <strong>Your knowledge map starts empty</strong>
            <span>
              Concepts appear here as you learn them — strengthened by recall, quizzes, and the
              connections you draw between ideas.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setGraphView('reference')}>See the reference map</button>
              <Link className="kg-tb-btn accent" href={`/course/${courseId}`}>Start learning</Link>
            </div>
          </div>
        ) : visibleData.nodes.length === 0 && (
          <div className="kg-canvas-overlay kg-empty-canvas">
            <strong>No concepts to show</strong>
            <span>
              {graphData && graphData.nodes.length > 0
                ? 'Current filters hide every concept.'
                : 'This course has no concepts yet.'}
            </span>
            {graphData && graphData.nodes.length > 0 && (
              <button onClick={() => { setActiveBranch('all'); setSearch(''); setCollapsedBranches(new Set()); setFilters(DEFAULT_FILTERS) }}>
                Reset filters
              </button>
            )}
          </div>
        )}

        {/* Zoom controls */}
        <div className="kg-canvas-overlay kg-zoom-cluster">
          <div className="kg-zoom-pill">
            <button onClick={() => setView((v) => ({ ...v, k: Math.min(2, v.k + 0.1) }))} title="Zoom in" aria-label="Zoom in">+</button>
            <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.18, v.k - 0.1) }))} title="Zoom out" aria-label="Zoom out">−</button>
            <button onClick={() => centerNode(selectedNode)} title="Center selected" aria-label="Center selected">◎</button>
            <button onClick={() => setView(overviewView(visibleData))} title="Fit to view" aria-label="Fit to view">↺</button>
          </div>
          <div className="kg-zoom-value">{Math.round(view.k * 100)}%</div>
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

        {/* Reopen tab — only when a node is selected but the panel is tucked away */}
        {selectedNode && panelCollapsed && (
          <button
            className="kg-canvas-overlay kg-panel-reopen"
            type="button"
            onClick={() => setPanelCollapsed(false)}
            title={`Show details for ${selectedNode.title}`}
            aria-label="Show concept details"
          >
            ❮
          </button>
        )}
      </main>

      {/* ── Right detail panel — exists only for a clicked node ── */}
      {panelOpen && (
        <GraphDetailPanel
          node={selectedNode}
          data={visibleData}
          courseId={courseId}
          onSelect={handleSelect}
          focusMode={filters.focusMode}
          onToggleFocus={() => toggleFilter('focusMode')}
          onDeleteConnection={deleteConnection}
          onCollapse={() => setPanelCollapsed(true)}
          connecting={Boolean(connectingFrom)}
          onStartConnect={() => {
            if (!selectedNode?.teachable) return
            setConnectionNote('')
            setConnectingFrom(connectingFrom ? null : selectedNode.id)
          }}
        />
      )}
    </div>
  )
}
