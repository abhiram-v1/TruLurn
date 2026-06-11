'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconArrowsMaximize,
  IconBinaryTree2,
  IconBraces,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconStack2,
} from '@tabler/icons-react'
import { KnowledgeGraph } from './KnowledgeGraph'
import { GraphMinimap } from './GraphMinimap'
import { AppIcon } from '@/components/branding/AppIcon'
import type { GraphData } from '@/lib/graph/types'

type MapTopic = {
  id: string
  branch_id: string
  section?: string
  title: string
  parent_id?: string | null
  depth_level?: number
  node_type?: string
  children_count?: number
  estimated_pages?: number
  prerequisites?: string[]
}

type SandboxResult = {
  curriculum: Record<string, unknown>
  map: {
    branches?: Array<{ id: string; title: string }>
    topics?: MapTopic[]
    structural_edges?: unknown[]
  }
  graph: GraphData
  researchReport: Record<string, unknown> | null
  diagnostics: {
    provider: string
    totalMs: number
    stageTimes: Record<string, number>
    topicCount: number
    structuralNodeCount: number
    edgeCount: number
    boxCount: number
    isolatedCount: number
  }
}

const DEFAULT_PROMPT = `Create a complete Machine Learning course that moves from mathematical and data foundations through supervised learning, unsupervised learning, model evaluation, neural networks, and practical system building. Use recursive Traccia containers where the subject naturally branches, stop at independently learnable concepts, and model only genuine prerequisites.`

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function overviewView(graph: GraphData, showTree: boolean) {
  const availableHeight = Math.max(440, window.innerHeight - 62)
  const availableWidth = Math.max(620, window.innerWidth - 340 - (showTree ? 350 : 0))
  const scale = Math.min(
    0.78,
    Math.max(0.28, (availableHeight - 56) / Math.max(graph.canvasH, 1)),
  )
  return {
    x: Math.max(24, Math.min(54, (availableWidth - graph.canvasW * scale) / 2)),
    y: Math.max(24, (availableHeight - graph.canvasH * scale) / 2),
    k: scale,
  }
}

function RecursiveMap({ topics, selectedId, onSelect }: {
  topics: MapTopic[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { roots, children } = useMemo(() => {
    const ids = new Set(topics.map((topic) => topic.id))
    const childMap = new Map<string, MapTopic[]>()
    topics.forEach((topic) => {
      if (!topic.parent_id || !ids.has(topic.parent_id)) return
      if (!childMap.has(topic.parent_id)) childMap.set(topic.parent_id, [])
      childMap.get(topic.parent_id)!.push(topic)
    })
    const rootTopics = topics.filter((topic) => !topic.parent_id || !ids.has(topic.parent_id))
    return { roots: rootTopics, children: childMap }
  }, [topics])

  function renderTopic(topic: MapTopic, depth: number) {
    const descendants = children.get(topic.id) ?? []
    const structural = topic.node_type === 'container' || descendants.length > 0
    return (
      <li key={topic.id} className="gs-tree-item">
        <button
          type="button"
          className={`gs-tree-row${selectedId === topic.id ? ' selected' : ''}`}
          style={{ paddingLeft: 12 + Math.min(depth, 5) * 16 }}
          onClick={() => onSelect(topic.id)}
        >
          <span className={`gs-tree-glyph ${structural ? 'container' : 'leaf'}`}>
            {structural ? <IconStack2 size={13} /> : <span />}
          </span>
          <span className="gs-tree-copy">
            <strong>{topic.title}</strong>
            <small>
              {structural ? `${descendants.length} children` : `${topic.estimated_pages ?? 0} planned pages`}
            </small>
          </span>
        </button>
        {descendants.length > 0 && (
          <ul>{descendants.map((child) => renderTopic(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  return <ul className="gs-tree">{roots.map((topic) => renderTopic(topic, 0))}</ul>
}

export function GraphSandbox() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [courseDepth, setCourseDepth] = useState('standard')
  const [knowledgeLevel, setKnowledgeLevel] = useState('intermediate')
  const [learningPurpose, setLearningPurpose] = useState('practitioner')
  const [learningControl, setLearningControl] = useState('balanced')
  const [includeResearch, setIncludeResearch] = useState(false)
  const [generationProfile, setGenerationProfile] = useState<'fast' | 'production'>('fast')
  const [result, setResult] = useState<SandboxResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [generationStage, setGenerationStage] = useState<'idle' | 'research' | 'curriculum' | 'map'>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [view, setView] = useState({ x: 36, y: 28, k: 0.62 })
  const [showRecommended, setShowRecommended] = useState(false)
  const [showSemantic, setShowSemantic] = useState(false)
  const [showAllConnections, setShowAllConnections] = useState(false)
  const [showTree, setShowTree] = useState(true)
  const [showJson, setShowJson] = useState(false)
  const generationController = useRef<AbortController | null>(null)

  const topics = result?.map.topics ?? []
  const selectedTopic = topics.find((topic) => topic.id === selectedId) ?? null

  useEffect(() => {
    if (!loading) return
    const startedAt = Date.now()
    setElapsedSeconds(0)
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [loading])

  async function generate() {
    generationController.current?.abort()
    const controller = new AbortController()
    generationController.current = controller
    setLoading(true)
    setError(null)
    try {
      setGenerationStage(includeResearch ? 'research' : 'curriculum')
      const curriculumResponse = await fetch('/api/curriculum', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          courseDepth,
          knowledgeLevel,
          learningPurpose,
          learningControl,
          includeResearch,
          generationProfile,
        }),
      })
      const curriculumData = await curriculumResponse.json()
      if (!curriculumResponse.ok) {
        throw new Error(curriculumData.error ?? 'Curriculum generation failed.')
      }

      setGenerationStage('map')
      const mapResponse = await fetch('/api/map', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curriculum: curriculumData.curriculum,
          generationProfile,
        }),
      })
      const mapData = await mapResponse.json()
      if (!mapResponse.ok) throw new Error(mapData.error ?? 'Graph topology generation failed.')

      const data: SandboxResult = {
        curriculum: curriculumData.curriculum,
        researchReport: curriculumData.researchReport,
        map: mapData.map,
        graph: mapData.graph,
        diagnostics: {
          provider: curriculumData.provider,
          totalMs: Number(curriculumData.totalMs ?? 0) + Number(mapData.mapMs ?? 0),
          stageTimes: {
            ...(curriculumData.stageTimes ?? {}),
            map: mapData.mapMs ?? 0,
          },
          ...mapData.diagnostics,
        },
      }
      setResult(data)
      const firstId = data.graph?.nextBestNodeId ?? data.graph?.nodes?.[0]?.id ?? null
      setSelectedId(firstId)
      setView(overviewView(data.graph, showTree))
    } catch (generationError) {
      if (controller.signal.aborted) {
        setError('Generation cancelled.')
      } else {
        setError(generationError instanceof Error ? generationError.message : 'Graph generation failed.')
      }
    } finally {
      if (generationController.current === controller) {
        generationController.current = null
        setLoading(false)
        setGenerationStage('idle')
      }
    }
  }

  function cancelGeneration() {
    generationController.current?.abort()
  }

  return (
    <div className="kg-app gs-app">
      <header className="gs-topbar">
        <div className="gs-brand">
          <AppIcon className="kg-brand-mark" size={22} />
          <div>
            <strong>Graph generation sandbox</strong>
            <span>Non-persistent Atlas and recursive Traccia testing</span>
          </div>
        </div>

        <div className="gs-top-actions">
          {result && (
            <div className="gs-run-meta">
              <span>{result.diagnostics.provider}</span>
              <span>{formatDuration(result.diagnostics.totalMs)}</span>
              <span>{result.diagnostics.topicCount} teachable</span>
              <span>{result.diagnostics.structuralNodeCount} structural</span>
            </div>
          )}
          <button
            type="button"
            className={`kg-tb-btn${showRecommended ? ' active' : ''}`}
            onClick={() => setShowRecommended((value) => !value)}
            disabled={!result}
          >
            Recommended
          </button>
          <button
            type="button"
            className={`kg-tb-btn${showSemantic ? ' active' : ''}`}
            onClick={() => setShowSemantic((value) => !value)}
            disabled={!result}
          >
            Semantic
          </button>
          <button
            type="button"
            className={`kg-tb-btn${showAllConnections ? ' active' : ''}`}
            onClick={() => setShowAllConnections((value) => !value)}
            disabled={!result}
          >
            All
          </button>
          <button
            type="button"
            className={`kg-tb-btn${showTree ? ' active' : ''}`}
            onClick={() => setShowTree((value) => !value)}
            disabled={!result}
          >
            <IconBinaryTree2 size={14} />
            Traccia
          </button>
          <button
            type="button"
            className={`kg-tb-btn${showJson ? ' active' : ''}`}
            onClick={() => setShowJson((value) => !value)}
            disabled={!result}
          >
            <IconBraces size={14} />
            JSON
          </button>
        </div>
      </header>

      <aside className="gs-controls">
        <div className="gs-controls-head">
          <span>Generation prompt</span>
          <button type="button" title="Restore default prompt" onClick={() => setPrompt(DEFAULT_PROMPT)}>
            <IconRefresh size={15} />
          </button>
        </div>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />

        <div className="gs-field-grid">
          <label className="gs-field-wide">
            <span>Generation profile</span>
            <select
              value={generationProfile}
              onChange={(event) => setGenerationProfile(event.target.value as 'fast' | 'production')}
            >
              <option value="fast">Fast sandbox</option>
              <option value="production">Production parity</option>
            </select>
          </label>
          <label>
            <span>Depth</span>
            <select value={courseDepth} onChange={(event) => setCourseDepth(event.target.value)}>
              <option value="low">Low</option>
              <option value="standard">Standard</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            <span>Knowledge</span>
            <select value={knowledgeLevel} onChange={(event) => setKnowledgeLevel(event.target.value)}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="expert">Expert</option>
            </select>
          </label>
          <label>
            <span>Purpose</span>
            <select value={learningPurpose} onChange={(event) => setLearningPurpose(event.target.value)}>
              <option value="explorer">Explorer</option>
              <option value="practitioner">Practitioner</option>
              <option value="researcher">Researcher</option>
            </select>
          </label>
          <label>
            <span>Progression</span>
            <select value={learningControl} onChange={(event) => setLearningControl(event.target.value)}>
              <option value="guided">Guided</option>
              <option value="balanced">Balanced</option>
              <option value="open">Open</option>
            </select>
          </label>
        </div>

        <p className="gs-profile-note">
          {generationProfile === 'fast'
            ? 'Uses the mini model for rapid graph experiments. Structure and renderer code remain identical.'
            : 'Uses the full production model. Large courses can take several minutes.'}
        </p>

        <label className="gs-check">
          <input
            type="checkbox"
            checked={includeResearch}
            onChange={(event) => setIncludeResearch(event.target.checked)}
          />
          <span>
            <strong>Include curriculum research</strong>
            <small>Adds the same bounded web calibration used by real AI-teacher courses.</small>
          </span>
        </label>

        {loading ? (
          <button type="button" className="gs-generate" onClick={cancelGeneration}>
            Cancel generation
          </button>
        ) : (
          <button
            type="button"
            className="gs-generate"
            onClick={generate}
            disabled={prompt.trim().length < 10}
          >
            <IconPlayerPlay size={17} />
            Generate sandbox graph
          </button>
        )}

        {error && <div className="gs-error">{error}</div>}

        {result && (
          <div className="gs-diagnostics">
            <div className="gs-section-label">Run diagnostics</div>
            <dl>
              <div><dt>Curriculum</dt><dd>{formatDuration(result.diagnostics.stageTimes.curriculum ?? 0)}</dd></div>
              <div><dt>Map</dt><dd>{formatDuration(result.diagnostics.stageTimes.map ?? 0)}</dd></div>
              {result.diagnostics.stageTimes.research != null && (
                <div><dt>Research</dt><dd>{formatDuration(result.diagnostics.stageTimes.research)}</dd></div>
              )}
              <div><dt>Edges</dt><dd>{result.diagnostics.edgeCount}</dd></div>
              <div><dt>Groups</dt><dd>{result.diagnostics.boxCount}</dd></div>
              <div><dt>Isolated</dt><dd>{result.diagnostics.isolatedCount}</dd></div>
            </dl>
          </div>
        )}

        <p className="gs-safety-note">
          Nothing generated here is written to MongoDB or shown on the home page.
        </p>
      </aside>

      <main className={`gs-workspace${showTree && result ? ' with-tree' : ''}`}>
        {!result && !loading && (
          <div className="gs-empty">
            <IconBinaryTree2 size={34} stroke={1.4} />
            <strong>Ready to test the generation engine</strong>
            <p>Run the Machine Learning prompt to inspect the graph and its full recursive map.</p>
          </div>
        )}

        {loading && (
          <div className="gs-empty generating">
            <span className="gs-orbit"><IconStack2 size={25} /></span>
            <strong>
              {generationStage === 'research' && 'Researching curriculum structure'}
              {generationStage === 'curriculum' && 'Generating recursive curriculum'}
              {generationStage === 'map' && 'Building graph topology'}
            </strong>
            <p>
              {generationStage === 'research' && 'Calibrating the course against reputable learning structures.'}
              {generationStage === 'curriculum' && 'Designing Atlas branches and recursive Traccia learning units.'}
              {generationStage === 'map' && 'Mapping genuine prerequisites, study recommendations, and visual groups.'}
            </p>
            <span className="gs-elapsed">{elapsedSeconds}s elapsed</span>
          </div>
        )}

        {result && (
          <>
            <section className="gs-graph-panel">
              <KnowledgeGraph
                data={result.graph}
                selectedId={selectedId}
                focusId={null}
                onSelect={setSelectedId}
                hoverId={hoverId}
                setHoverId={setHoverId}
                showCritical={false}
                showRegions
                showRecommended={showRecommended}
                showSemantic={showSemantic}
                showAllConnections={showAllConnections}
                showLocked
                view={view}
                setView={setView}
              />
              <GraphMinimap
                data={result.graph}
                selectedId={selectedId}
                view={view}
                setView={setView}
              />
              <div className="gs-canvas-tools">
                <button type="button" onClick={() => setView((current) => ({ ...current, k: Math.min(2, current.k + 0.1) }))}>+</button>
                <button type="button" onClick={() => setView((current) => ({ ...current, k: Math.max(0.2, current.k - 0.1) }))}>-</button>
                <button type="button" title="Fit graph height" onClick={() => setView(overviewView(result.graph, showTree))}>
                  <IconArrowsMaximize size={14} />
                </button>
              </div>
            </section>

            {showTree && (
              <aside className="gs-tree-panel">
                <div className="gs-tree-head">
                  <div>
                    <span>Recursive Traccia</span>
                    <strong>{String(result.curriculum.title ?? 'Generated course')}</strong>
                  </div>
                  <small>{topics.length} total nodes</small>
                </div>
                <div className="gs-tree-scroll">
                  <RecursiveMap topics={topics} selectedId={selectedId} onSelect={setSelectedId} />
                </div>
                {selectedTopic && (
                  <div className="gs-tree-detail">
                    <span>{selectedTopic.node_type ?? 'learning_unit'}</span>
                    <strong>{selectedTopic.title}</strong>
                    <p>
                      Depth {selectedTopic.depth_level ?? 0}
                      {' · '}
                      {selectedTopic.prerequisites?.length ?? 0} prerequisites
                    </p>
                  </div>
                )}
              </aside>
            )}

            {showJson && (
              <aside className="gs-json-panel">
                <div className="gs-json-head">
                  <span>Raw generation output</span>
                  <button type="button" onClick={() => setShowJson(false)}>Close</button>
                </div>
                <pre>{JSON.stringify({ curriculum: result.curriculum, map: result.map }, null, 2)}</pre>
              </aside>
            )}
          </>
        )}
      </main>
    </div>
  )
}
