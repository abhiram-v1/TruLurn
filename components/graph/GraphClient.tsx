'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { GraphData, GraphNode } from '@/lib/graph/types'
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

function overviewView(graph: GraphData) {
  const availableHeight = Math.max(420, window.innerHeight - 52)
  const availableWidth = Math.max(520, window.innerWidth - 232 - 320)
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
        setView(overviewView(data))
        // Auto-select the current / active topic on load
        const current = data.nodes.find((n) => n.current) ?? data.nodes.find((n) => n.state === 'active')
        if (current) setSelectedId(current.id)
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

  // ── Critical path — backward BFS from a locked node to nearest completed anchor ──
  // Highlights the exact prerequisite chain the student needs to complete to unlock
  // a selected locked topic. Nodes and edges on the path get a special visual class.
  const criticalPath = useMemo((): { nodes: Set<string>; edges: Set<string> } => {
    const empty = { nodes: new Set<string>(), edges: new Set<string>() }
    if (!graphData || !selectedNode?.teachable || selectedNode.state !== 'locked') return empty

    const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]))
    // Build reverse adjacency (incoming edges per node)
    const revAdj = new Map<string, Array<{ from: string; key: string }>>()
    for (const e of graphData.edges) {
      if (!['prerequisite', 'sequence'].includes(e.edgeType)) continue
      if (e.edgeType === 'prerequisite' && e.prereqStrength === 'soft') continue
      if (!revAdj.has(e.to)) revAdj.set(e.to, [])
      revAdj.get(e.to)!.push({ from: e.from, key: `${e.from}::${e.to}` })
    }

    // BFS backwards from selected locked node
    // Stop expanding a node once we hit a mastered/functional anchor
    const pathNodes = new Set<string>()
    const pathEdges = new Set<string>()
    const queue: string[] = [selectedNode.id]
    const visited = new Set<string>([selectedNode.id])

    while (queue.length) {
      const cur = queue.shift()!
      pathNodes.add(cur)
      const node = nodeById.get(cur)
      // Mastered/functional = solid foundation, include in path but don't trace further back
      if (node && (node.state === 'mastered' || node.state === 'functional')) continue
      for (const { from, key } of revAdj.get(cur) ?? []) {
        pathEdges.add(key)
        if (!visited.has(from)) {
          visited.add(from)
          queue.push(from)
        }
      }
    }

    return { nodes: pathNodes, edges: pathEdges }
  }, [graphData, selectedNode])

  // ── Orientation (persistent "where am I / what's next") ────────────────────
  const orientation = useMemo(() => {
    if (!graphData) return null
    const nodes = graphData.nodes
    const current = nodes.find((n) => n.current) ?? nodes.find((n) => n.state === 'active') ?? null
    const next = graphData.nextBestNodeId
      ? nodes.find((n) => n.id === graphData.nextBestNodeId) ?? null
      : null
    const totalStages = nodes.reduce((m, n) => Math.max(m, n.layer ?? 0), 0) + 1
    return { current, next, totalStages, mastery: graphData.course.masteryScore }
  }, [graphData])

  // ── States ────────────────────────────────────────────────────────────────
  function centerNode(node: GraphNode | null = selectedNode) {
    if (!node) return
    const mainW = Math.max(520, window.innerWidth - 232 - 320)
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
  const total = course.topicCount || 1
  const seg = (n: number) => `${(n / total) * 100}%`
  const solidCount = course.mastered + course.functional
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

          <div className="kg-topbar-progress">
            <div className="kg-progress-bar">
              <span className="pb-mastered"   style={{ width: seg(course.mastered) }} />
              <span className="pb-functional" style={{ width: seg(course.functional) }} />
              <span className="pb-partial"    style={{ width: seg(course.partial) }} />
              <span className="pb-unstable"   style={{ width: seg(course.unstable) }} />
            </div>
            <div className="kg-progress-num">
              {solidCount}/{course.topicCount} solid
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
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </div>
          <button className="kg-tb-btn" type="button" onClick={() => centerNode(selectedNode)} disabled={!selectedNode}>
            Center
          </button>
          {selectedNode?.teachable && (
            <button
              className={`kg-tb-btn${connectingFrom ? ' accent' : ''}`}
              type="button"
              onClick={() => {
                setConnectionNote('')
                setConnectingFrom(connectingFrom ? null : selectedNode.id)
              }}
              title="Link this concept to another one you know"
            >
              {connectingFrom ? 'Cancel link' : '⌁ Connect'}
            </button>
          )}
          <Link className="kg-tb-btn" href={`/course/${courseId}`}>Atlas</Link>
          {selectedNode?.teachable && selectedNode.state !== 'locked' && (
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

        {/* Orientation HUD — where am I · what's next · recenter */}
        {orientation && (
          <div className="kg-canvas-overlay kg-hud">
            {graphView === 'knowledge' && typeof graphData?.fullTopicCount === 'number' && (
              <>
                <div className="kg-hud-current" title="Concepts on your personal map vs the whole course">
                  <span className="kg-hud-stage">On your map</span>
                  <strong>{graphData.course.topicCount} / {graphData.fullTopicCount}</strong>
                </div>
                <div className="kg-hud-sep" />
              </>
            )}
            <div className="kg-hud-mastery" title="Overall mastery">
              <span className="kg-hud-bar"><span style={{ width: `${orientation.mastery}%` }} /></span>
              <span className="kg-hud-pct">{orientation.mastery}%</span>
            </div>
            <div className="kg-hud-sep" />
            <div className="kg-hud-current">
              {orientation.current ? (
                <>
                  <span className="kg-hud-stage">Stage {(orientation.current.layer ?? 0) + 1}/{orientation.totalStages}</span>
                  <strong title={orientation.current.title}>{orientation.current.title}</strong>
                </>
              ) : (
                <span className="kg-hud-stage">Not started yet</span>
              )}
            </div>
            {orientation.next && (
              <button
                className="kg-hud-next"
                onClick={() => { setSelectedId(orientation.next!.id); centerNode(orientation.next) }}
                title={`Recommended next: ${orientation.next.title}`}
              >
                Next: {orientation.next.title} <span className="arrow">→</span>
              </button>
            )}
            <button
              className="kg-hud-recenter"
              onClick={() => { if (orientation.current) { setSelectedId(orientation.current.id); centerNode(orientation.current) } }}
              disabled={!orientation.current}
              title="Recenter on current topic"
            >
              ◎ Recenter
            </button>
          </div>
        )}

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
        onDeleteConnection={deleteConnection}
      />
    </div>
  )
}
