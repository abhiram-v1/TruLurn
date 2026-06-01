/* global React, ReactDOM, GRAPH_DATA, KnowledgeGraph, StatePill, DifficultyBars, ImportanceStack,
   TweaksPanel, useTweaks, TweakSection, TweakToggle, TweakRadio, TweakSlider, TweakColor */

const { useState, useMemo, useEffect, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showRegions": true,
  "showCritical": true,
  "showRecommended": true,
  "showLocked": true,
  "showWeak": true,
  "edgeStyle": "curved",
  "nodeSize": "scaled",
  "focusMode": false,
  "density": 1
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [selectedId, setSelectedId] = useState('linreg');
  const [hoverId, setHoverId] = useState(null);
  const [search, setSearch] = useState('');
  const [activeBranch, setActiveBranch] = useState('all');
  const [view, setView] = useState({ x: 12, y: 4, k: 0.78 });

  const data = useMemo(() => {
    // Filter nodes per active branch / search / showLocked
    let nodes = GRAPH_DATA.nodes;
    if (!t.showLocked) nodes = nodes.filter(n => n.state !== 'locked');
    if (activeBranch !== 'all') nodes = nodes.filter(n => n.branch === activeBranch);
    if (search.trim()) {
      const q = search.toLowerCase();
      const matched = new Set(GRAPH_DATA.nodes.filter(n => n.title.toLowerCase().includes(q)).map(n=>n.id));
      // Always keep matched nodes (full graph view), we'll fade rest in CSS
      nodes = nodes.map(n => ({ ...n, _dim: !matched.has(n.id) }));
    }
    let edges = GRAPH_DATA.edges.filter(e => {
      const ok = nodes.some(n=>n.id===e.from) && nodes.some(n=>n.id===e.to);
      if (!ok) return false;
      if (!t.showWeak && e.strength === 'weak') return false;
      return true;
    });
    return { ...GRAPH_DATA, nodes, edges };
  }, [t.showLocked, t.showWeak, activeBranch, search]);

  const selected = useMemo(
    () => GRAPH_DATA.nodes.find(n => n.id === selectedId) || null,
    [selectedId]
  );

  // Set focus only when "Focus mode" is on
  const focusId = t.focusMode && selectedId ? selectedId : null;

  // Cmd+K to focus search
  const searchRef = useRef();
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Topbar
        course={GRAPH_DATA.course}
        search={search} setSearch={setSearch} searchRef={searchRef}
      />

      <Sidebar
        branches={GRAPH_DATA.branches}
        activeBranch={activeBranch}
        setActiveBranch={setActiveBranch}
        course={GRAPH_DATA.course}
        tweaks={t}
        setTweak={setTweak}
      />

      <main className="main">
        <KnowledgeGraph
          data={data}
          selectedId={selectedId}
          focusId={focusId}
          onSelect={setSelectedId}
          hoverId={hoverId}
          setHoverId={setHoverId}
          tweaks={t}
          view={view}
          setView={setView}
        />

        {/* Overlays */}
        <div className="canvas-overlay zoom-cluster">
          <div className="zoom-pill">
            <button onClick={() => setView(v => ({ ...v, k: Math.min(1.6, v.k + 0.1) }))}>+</button>
            <button onClick={() => setView(v => ({ ...v, k: Math.max(0.35, v.k - 0.1) }))}>−</button>
            <button onClick={() => setView({ x: 12, y: 4, k: 0.78 })} title="Fit">⤢</button>
          </div>
          <div className="zoom-value">{Math.round(view.k * 100)}%</div>
        </div>

        <div className="canvas-overlay legend-card">
          <span><span className="pip" style={{background:'var(--mastered-dot)'}}/>Mastered</span>
          <span><span className="pip" style={{background:'var(--functional-dot)'}}/>Functional</span>
          <span><span className="pip" style={{background:'var(--partial-dot)'}}/>Partial</span>
          <span><span className="pip" style={{background:'var(--unstable-dot)'}}/>Unstable</span>
          <span><span className="pip" style={{background:'var(--locked-line)', border:'1px dashed var(--locked-line)'}}/>Locked</span>
        </div>

        {t.showCritical && (
          <div className="canvas-overlay path-banner">
            <span className="dot" />
            <strong>Critical path</strong>
            <span style={{color:'var(--muted)'}}>·</span>
            <span style={{color:'var(--muted)'}}>Linear Algebra → Linear Regression → Cost Functions → Gradient Descent → Backpropagation</span>
          </div>
        )}

        {focusId && selected && (
          <div className="canvas-overlay focus-banner">
            <span className="dot" />
            Focus mode · {selected.title} and 1-hop neighborhood
            <button onClick={() => setTweak('focusMode', false)}>Exit</button>
          </div>
        )}

        <button className="canvas-overlay ai-tutor">
          <span className="ai-dot">◆</span>
          Ask the tutor about {selected ? selected.title : 'this graph'}
        </button>

        <Minimap data={GRAPH_DATA} selectedId={selectedId} view={view} setView={setView} />
      </main>

      <DetailPanel
        node={selected}
        data={GRAPH_DATA}
        onSelect={setSelectedId}
        setTweak={setTweak}
        focusMode={t.focusMode}
      />

      <TweaksPanelHost t={t} setTweak={setTweak} />
    </div>
  );
}

/* ───────────────── Topbar ───────────────── */
function Topbar({ course, search, setSearch, searchRef }) {
  const total = course.topicCount;
  const seg = (n) => `${(n / total) * 100}%`;
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark">T</span>
        <span className="brand-name">TruLurn</span>
      </div>

      <div className="topbar-center">
        <div className="crumbs">
          <span>Courses</span><span className="sep">/</span>
          <strong>{course.title}</strong><span className="sep">/</span>
          <span>Knowledge graph</span>
        </div>

        <div className="topbar-progress">
          <div className="progress-bar" title="Mastery composition">
            <span className="pb-mastered"   style={{ width: seg(course.mastered) }}/>
            <span className="pb-functional" style={{ width: seg(course.functional) }}/>
            <span className="pb-partial"    style={{ width: seg(course.partial) }}/>
            <span className="pb-unstable"   style={{ width: seg(course.unstable) }}/>
          </div>
          <div className="progress-num">
            <strong style={{color:'var(--ink)', fontWeight:500}}>{course.mastered}</strong> mastered · {course.partial + course.unstable} weak · {course.locked} locked
          </div>
        </div>
      </div>

      <div className="topbar-right">
        <div className="search">
          <span style={{color:'var(--muted)', fontSize:'12px'}}>⌕</span>
          <input
            ref={searchRef}
            placeholder="Search concepts"
            value={search}
            onChange={(e)=>setSearch(e.target.value)}
          />
          <kbd>⌘K</kbd>
        </div>
        <button className="tb-btn">Big roadmap</button>
        <button className="tb-btn accent"><span className="dot" style={{background:'var(--bg)'}}/>Resume study</button>
      </div>
    </header>
  );
}

/* ───────────────── Sidebar ───────────────── */
function Sidebar({ branches, activeBranch, setActiveBranch, course, tweaks, setTweak }) {
  return (
    <aside className="sidebar">
      <div className="sb-scroll">
        <div className="sb-section">
          <div className="sb-label">Course</div>
          <div style={{display:'grid', gap:6}}>
            <div style={{fontSize:13, fontWeight:500}}>Machine Learning Foundations</div>
            <div style={{fontSize:11, color:'var(--muted)'}}>
              32 topics · {Math.round((course.mastered + course.functional + 0.5 * course.partial) / course.topicCount * 100)}% understood
            </div>
            <div className="progress-bar" style={{marginTop:6}}>
              <span className="pb-mastered"   style={{ width: `${(course.mastered/course.topicCount)*100}%` }}/>
              <span className="pb-functional" style={{ width: `${(course.functional/course.topicCount)*100}%` }}/>
              <span className="pb-partial"    style={{ width: `${(course.partial/course.topicCount)*100}%` }}/>
              <span className="pb-unstable"   style={{ width: `${(course.unstable/course.topicCount)*100}%` }}/>
            </div>
          </div>
        </div>

        <div className="sb-section" style={{padding:'10px 0'}}>
          <div className="sb-label" style={{padding:'0 16px'}}>Branches</div>
          <div style={{display:'grid'}}>
            <button
              className={`branch-row ${activeBranch === 'all' ? 'current' : ''}`}
              onClick={() => setActiveBranch('all')}
            >
              <span className="branch-dot" style={{background:'var(--accent)'}}/>
              <span>All concepts</span>
              <span className="branch-count">{course.topicCount}</span>
            </button>
            {branches.map(b => (
              <button
                key={b.id}
                className={`branch-row ${activeBranch === b.id ? 'current' : ''} ${b.color === 'locked' ? 'dim' : ''}`}
                onClick={() => setActiveBranch(b.id)}
              >
                <span className={`branch-dot ${b.color}`} />
                <span>{b.title}</span>
                <span className="branch-count">{b.mastered}/{b.topicCount}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sb-section">
          <div className="sb-label">Filters</div>
          <div className="filters">
            <FilterToggle label="Show locked topics" on={tweaks.showLocked} onChange={(v)=>setTweak('showLocked', v)} />
            <FilterToggle label="Show weak links"    on={tweaks.showWeak}   onChange={(v)=>setTweak('showWeak', v)} />
            <FilterToggle label="Highlight critical path" on={tweaks.showCritical} onChange={(v)=>setTweak('showCritical', v)} />
            <FilterToggle label="Domain regions"      on={tweaks.showRegions} onChange={(v)=>setTweak('showRegions', v)} />
            <FilterToggle label="Suggested next"      on={tweaks.showRecommended} onChange={(v)=>setTweak('showRecommended', v)} />
            <FilterToggle label="Focus mode"          on={tweaks.focusMode}  onChange={(v)=>setTweak('focusMode', v)} />
          </div>
        </div>

        <div className="sb-section">
          <div className="sb-label">Mastery legend</div>
          <div className="legend">
            <LegendRow color="mastered-dot"   label="Mastered"   count={course.mastered} />
            <LegendRow color="functional-dot" label="Functional" count={course.functional} />
            <LegendRow color="partial-dot"    label="Partial"    count={course.partial} />
            <LegendRow color="unstable-dot"   label="Unstable"   count={course.unstable} />
            <LegendRow color="accent"         label="Active"     count={course.active} />
            <LegendRow color="line"           label="Locked"     count={course.locked} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function FilterToggle({ label, on, onChange }) {
  return (
    <button className="filter-row" style={{background:'none', border:0, padding:0, color:'inherit', width:'100%'}}
            onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className={`toggle ${on ? 'on' : ''}`} />
    </button>
  );
}

function LegendRow({ color, label, count }) {
  return (
    <div className="legend-row">
      <span className="swatch" style={{background:`var(--${color})`}}/>
      <span>{label}</span>
      <span className="count">{count}</span>
    </div>
  );
}

/* ───────────────── Minimap ───────────────── */
function Minimap({ data, selectedId, view, setView }) {
  const W = 200, H = 110;
  const CW = 1700, CH = 920;
  const sx = W / CW, sy = H / CH;

  const onClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Center viewport on click
    const targetX = mx / sx, targetY = my / sy;
    setView(v => ({ ...v, x: -targetX * v.k + 500, y: -targetY * v.k + 320 }));
  };

  return (
    <div className="canvas-overlay minimap">
      <div className="minimap-head">
        <span>Overview</span>
        <span>{data.nodes.length} nodes</span>
      </div>
      <div className="minimap-body" onClick={onClick}>
        {data.nodes.map(n => (
          <div key={n.id} className="mini-node"
            style={{
              left: n.x * sx, top: n.y * sy,
              width: Math.max(3, n.w * sx),
              height: Math.max(2, 70 * sy),
              background: stateColor(n.state),
              opacity: selectedId === n.id ? 1 : 0.85,
              outline: selectedId === n.id ? '1px solid var(--accent)' : 'none',
            }}
          />
        ))}
        {/* Viewport rect: depends on stage size 1240x720 approx; approximate */}
        <MinimapViewport view={view} sx={sx} sy={sy} />
      </div>
    </div>
  );
}

function MinimapViewport({ view, sx, sy }) {
  // Compute visible canvas area in canvas-coords
  const stageW = 1200, stageH = 760; // approx — full main area is dynamic; close enough
  const x = -view.x / view.k, y = -view.y / view.k;
  const w = stageW / view.k, h = stageH / view.k;
  return (
    <div className="mini-vp" style={{
      left: x * sx, top: y * sy, width: w * sx, height: h * sy,
    }} />
  );
}

function stateColor(state) {
  return ({
    mastered:   'var(--mastered-dot)',
    functional: 'var(--functional-dot)',
    partial:    'var(--partial-dot)',
    unstable:   'var(--unstable-dot)',
    active:     'var(--accent)',
    locked:     'var(--locked-line)',
  })[state] || 'var(--line)';
}

/* ───────────────── Detail panel ───────────────── */
function DetailPanel({ node, data, onSelect, setTweak, focusMode }) {
  if (!node) {
    return (
      <aside className="detail">
        <div className="empty-detail">
          <strong>No concept selected</strong>
          <span>Click a node in the graph to inspect it.</span>
        </div>
      </aside>
    );
  }

  const incoming = data.edges.filter(e => e.to === node.id);
  const outgoing = data.edges.filter(e => e.from === node.id);
  const nodeById = (id) => data.nodes.find(n => n.id === id);

  return (
    <aside className="detail">
      <div className="detail-head">
        <div className="detail-kicker">{node.section}</div>
        <h2 className="detail-title">{node.title}</h2>
        <div className="detail-row">
          <StatePill state={node.state} />
          <span style={{fontSize:11, color:'var(--muted)'}}>·</span>
          <span style={{fontSize:11, color:'var(--muted)'}}>Importance</span>
          <ImportanceStack value={node.importance} />
          <span style={{fontSize:11, color:'var(--muted)'}}>·</span>
          <span style={{fontSize:11, color:'var(--muted)'}}>Difficulty</span>
          <DifficultyBars value={node.difficulty} />
        </div>
      </div>

      <div className="detail-scroll">
        {node.misconception && (
          <div className="detail-section">
            <div className="warn-block">
              <strong>Detected misconception</strong>
              <p>Your last quiz on this topic mixed up overfitting with high training error. The graph re-shows this until a quiz answer is conceptually clean.</p>
            </div>
          </div>
        )}

        {node.state !== 'locked' && (
          <div className="detail-section">
            <div className="detail-label">Mastery</div>
            <div className="mastery-bar">
              <span style={{ width: `${node.mastery}%`, background: stateColor(node.state) }} />
            </div>
            <div className="mastery-text">
              <span>Demonstrated understanding</span>
              <strong>{node.mastery}%</strong>
            </div>
          </div>
        )}

        <div className="detail-section">
          <div className="detail-label">Properties</div>
          <div className="detail-meta">
            <div className="meta-item">
              <div className="k">Branch</div>
              <div className="v" style={{textTransform:'capitalize'}}>{node.branch.replace('-', ' ')}</div>
            </div>
            <div className="meta-item">
              <div className="k">Prerequisites</div>
              <div className="v">{incoming.length}</div>
            </div>
            <div className="meta-item">
              <div className="k">Unlocks</div>
              <div className="v">{outgoing.length}</div>
            </div>
            <div className="meta-item">
              <div className="k">Position</div>
              <div className="v">Layer {Math.floor(node.x / 240) + 1}</div>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">Prerequisites ({incoming.length})</div>
          {incoming.length === 0 && (
            <div style={{color:'var(--muted)', fontSize:12}}>None — foundational topic.</div>
          )}
          <div className="dep-list">
            {incoming.map((e, i) => {
              const dep = nodeById(e.from);
              if (!dep) return null;
              return (
                <button
                  key={i}
                  className={`dep-item ${e.strength === 'weak' ? 'weak' : ''}`}
                  style={{background:'none', border:0, textAlign:'left', cursor:'pointer'}}
                  onClick={() => onSelect(dep.id)}
                >
                  <span className="branch-dot" style={{background: stateColor(dep.state), width:8, height:8}}/>
                  <span>{dep.title}</span>
                  <span className="strength">{e.strength}{e.critical ? ' · critical' : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">Unlocks ({outgoing.length})</div>
          {outgoing.length === 0 && (
            <div style={{color:'var(--muted)', fontSize:12}}>Leaf — no downstream concepts in this course.</div>
          )}
          <div className="dep-list">
            {outgoing.map((e, i) => {
              const tgt = nodeById(e.to);
              if (!tgt) return null;
              return (
                <button
                  key={i}
                  className={`dep-item ${e.strength === 'weak' ? 'weak' : ''}`}
                  style={{background:'none', border:0, textAlign:'left', cursor:'pointer'}}
                  onClick={() => onSelect(tgt.id)}
                >
                  <span className="branch-dot" style={{background: stateColor(tgt.state), width:8, height:8}}/>
                  <span>{tgt.title}</span>
                  <span className="strength">{e.strength}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">Suggested next</div>
          <div className="next-actions">
            {node.state === 'unstable' || node.state === 'partial' ? (
              <>
                <button className="primary">
                  Reinforce {node.title} <span className="arrow">→</span>
                </button>
                <button>Re-read core page · 5 min</button>
                <button>Targeted quiz · 3 questions</button>
              </>
            ) : node.state === 'active' ? (
              <>
                <button className="primary">Continue lesson · page 2 of 3 <span className="arrow">→</span></button>
                <button>Take topic quiz</button>
              </>
            ) : node.state === 'mastered' || node.state === 'functional' ? (
              <>
                <button>Review for retention</button>
                <button>Apply in advanced topic</button>
              </>
            ) : (
              <>
                <button>Unlock by completing prerequisites</button>
                <button onClick={() => incoming[0] && onSelect(incoming[0].from)}>
                  Jump to first prerequisite
                </button>
              </>
            )}
            <button onClick={() => setTweak('focusMode', !focusMode)}>
              {focusMode ? 'Exit focus mode' : 'Enter focus mode'}
            </button>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">Tags</div>
          <div className="tag-row">
            <span className="tag">{node.section}</span>
            <span className="tag">L{Math.floor(node.x / 240) + 1}</span>
            <span className="tag">imp {node.importance}/3</span>
            <span className="tag">diff {node.difficulty}/5</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ───────────────── Tweaks panel (host-driven) ───────────────── */
function TweaksPanelHost({ t, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Graph density">
        <TweakRadio
          label="Edge style"
          value={t.edgeStyle}
          onChange={(v) => setTweak('edgeStyle', v)}
          options={[{value:'curved', label:'Curved'}, {value:'orthogonal', label:'Step'}]}
        />
        <TweakRadio
          label="Node size"
          value={t.nodeSize}
          onChange={(v) => setTweak('nodeSize', v)}
          options={[{value:'scaled', label:'By importance'}, {value:'uniform', label:'Uniform'}]}
        />
      </TweakSection>

      <TweakSection label="Visibility">
        <TweakToggle label="Locked concepts"   value={t.showLocked}      onChange={(v)=>setTweak('showLocked', v)} />
        <TweakToggle label="Weak edges"        value={t.showWeak}        onChange={(v)=>setTweak('showWeak', v)} />
        <TweakToggle label="Critical path"     value={t.showCritical}    onChange={(v)=>setTweak('showCritical', v)} />
        <TweakToggle label="Domain regions"    value={t.showRegions}     onChange={(v)=>setTweak('showRegions', v)} />
        <TweakToggle label="Suggested-next badge" value={t.showRecommended} onChange={(v)=>setTweak('showRecommended', v)} />
      </TweakSection>

      <TweakSection label="Focus">
        <TweakToggle label="1-hop focus on select" value={t.focusMode} onChange={(v)=>setTweak('focusMode', v)} />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
