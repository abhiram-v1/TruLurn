/* global React */
/* Knowledge graph SVG renderer.
   Exports <KnowledgeGraph /> on window. */

const { useMemo, useRef, useEffect, useState } = React;

// Build a quick lookup index for nodes & adjacency.
function indexGraph(data) {
  const nodeById = new Map();
  data.nodes.forEach((n) => nodeById.set(n.id, n));
  const outAdj = new Map();
  const inAdj = new Map();
  data.edges.forEach((e) => {
    if (!outAdj.has(e.from)) outAdj.set(e.from, []);
    if (!inAdj.has(e.to)) inAdj.set(e.to, []);
    outAdj.get(e.from).push(e);
    inAdj.get(e.to).push(e);
  });
  return { nodeById, outAdj, inAdj };
}

// Importance → node height
const heightFor = (importance) => (importance === 3 ? 78 : importance === 2 ? 70 : 60);

// Build a smooth horizontal bezier between two node-anchor points.
function edgePath(a, b) {
  const dx = Math.max(40, (b.x - a.x) * 0.55);
  const c1 = `${a.x + dx},${a.y}`;
  const c2 = `${b.x - dx},${b.y}`;
  return `M${a.x},${a.y} C${c1} ${c2} ${b.x},${b.y}`;
}

// Domain regions (background bands) — bounding boxes inferred manually.
const REGIONS = [
  { id: 'foundations',  label: 'Foundations',           x: 40,   y: 170, w: 220, h: 460 },
  { id: 'supervised',   label: 'Supervised Core',       x: 270,  y: 110, w: 470, h: 700 },
  { id: 'unsup',        label: 'Unsupervised',          x: 750,  y: 460, w: 460, h: 360 },
  { id: 'ensemble',     label: 'Trees & Ensembles',     x: 750,  y: 80,  w: 220, h: 360 },
  { id: 'neural',       label: 'Neural Networks',       x: 990,  y: 140, w: 220, h: 580 },
  { id: 'deep',         label: 'Deep Learning',         x: 1230, y: 150, w: 410, h: 360 },
  { id: 'rl',           label: 'Reinforcement Learning',x: 990,  y: 560, w: 650, h: 320 },
];

window.KnowledgeGraph = function KnowledgeGraph({
  data,
  selectedId,
  focusId,
  onSelect,
  hoverId,
  setHoverId,
  tweaks,
  setView,
  view,
}) {
  const { nodeById, outAdj, inAdj } = useMemo(() => indexGraph(data), [data]);
  const stageRef = useRef(null);
  const innerRef = useRef(null);
  const [drag, setDrag] = useState(null);

  // Critical path node-ids (collected from edges marked critical)
  const criticalNodes = useMemo(() => {
    const s = new Set();
    data.edges.forEach((e) => {
      if (e.critical) {
        s.add(e.from); s.add(e.to);
      }
    });
    return s;
  }, [data]);

  // Determine fade set when a node is selected (show only its ego network)
  const egoSet = useMemo(() => {
    if (!focusId) return null;
    const set = new Set([focusId]);
    // 1-hop both directions
    (outAdj.get(focusId) || []).forEach((e) => set.add(e.to));
    (inAdj.get(focusId) || []).forEach((e) => set.add(e.from));
    return set;
  }, [focusId, outAdj, inAdj]);

  // Pan/zoom
  function onMouseDown(e) {
    if (e.target.closest('.node-card')) return;
    setDrag({ x: e.clientX, y: e.clientY, startX: view.x, startY: view.y });
  }
  function onMouseMove(e) {
    if (!drag) return;
    setView((v) => ({ ...v, x: drag.startX + (e.clientX - drag.x), y: drag.startY + (e.clientY - drag.y) }));
  }
  function onMouseUp() { setDrag(null); }

  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const rect = stageRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const next = Math.min(1.6, Math.max(0.35, v.k * factor));
      const k = next / v.k;
      return {
        k: next,
        x: mx - (mx - v.x) * k,
        y: my - (my - v.y) * k,
      };
    });
  }

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [drag]);

  // Edge geometry: compute anchor points (right side of source → left side of target)
  const edgeGeoms = useMemo(() => {
    return data.edges.map((e) => {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) return null;
      const ah = heightFor(a.importance);
      const bh = heightFor(b.importance);
      const start = { x: a.x + a.w, y: a.y + ah / 2 };
      const end   = { x: b.x,       y: b.y + bh / 2 };
      return { ...e, path: edgePath(start, end), midX: (start.x + end.x) / 2, midY: (start.y + end.y) / 2 };
    }).filter(Boolean);
  }, [data, nodeById]);

  // Build the connected edge set for hover/focus highlighting
  const litEdges = useMemo(() => {
    if (!hoverId && !selectedId) return null;
    const focus = selectedId || hoverId;
    const s = new Set();
    edgeGeoms.forEach((e, i) => {
      if (e.from === focus || e.to === focus) s.add(i);
    });
    return s;
  }, [edgeGeoms, hoverId, selectedId]);

  const showCritical = tweaks.showCritical;
  const showRegions = tweaks.showRegions;
  const showRecommended = tweaks.showRecommended;

  // Canvas extent
  const CANVAS_W = 1700;
  const CANVAS_H = 920;

  return (
    <div
      ref={stageRef}
      className={`canvas-stage ${drag ? 'dragging' : ''}`}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
    >
      <div
        ref={innerRef}
        className="canvas-inner"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: CANVAS_W, height: CANVAS_H }}
      >
        <svg width={CANVAS_W} height={CANVAS_H} style={{ display: 'block', overflow: 'visible' }}>
          {/* Regions */}
          {showRegions && REGIONS.map((r) => (
            <g key={r.id}>
              <rect className="region" x={r.x} y={r.y} width={r.w} height={r.h} rx="14" ry="14" />
              <text className="region-label" x={r.x + 14} y={r.y + 22}>{r.label}</text>
            </g>
          ))}

          {/* Edges */}
          <g>
            {edgeGeoms.map((e, i) => {
              const isCritical = showCritical && e.critical;
              const isLit = litEdges && litEdges.has(i);
              const isFaded = egoSet && !(egoSet.has(e.from) && egoSet.has(e.to));
              const cls = [
                'edge',
                e.strength,
                isCritical ? 'critical' : '',
                isLit ? 'highlight' : '',
                isFaded ? 'faded' : '',
              ].filter(Boolean).join(' ');
              return <path key={i} className={cls} d={e.path} />;
            })}
          </g>

          {/* Nodes */}
          <g>
            {data.nodes.map((n) => {
              const h = heightFor(n.importance);
              const isSelected = selectedId === n.id;
              const isFaded = egoSet && !egoSet.has(n.id);
              const isSuggested = showRecommended && n.suggested;
              const isMisc = n.misconception;
              const stateCls = `state-${n.state}`;
              const cardCls = [
                'node-card',
                stateCls,
                isSelected ? 'selected' : '',
                isSuggested ? 'suggested' : '',
                isMisc ? 'misconception' : '',
                isFaded ? 'faded' : '',
              ].filter(Boolean).join(' ');
              return (
                <foreignObject key={n.id} x={n.x} y={n.y} width={n.w} height={h} style={{ overflow: 'visible' }}>
                  <div
                    xmlns="http://www.w3.org/1999/xhtml"
                    className={cardCls}
                    onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    <div className="node-head">
                      <span className="node-title" title={n.title}>{n.title}</span>
                      <ImportanceStack value={n.importance} />
                    </div>
                    <div className="node-meta">
                      <StatePill state={n.state} />
                      <DifficultyBars value={n.difficulty} />
                    </div>
                    {n.state !== 'locked' && (
                      <div className={`node-prog ${n.state}`}>
                        <span style={{ width: `${n.mastery}%` }} />
                      </div>
                    )}
                  </div>
                </foreignObject>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
};

function StatePill({ state }) {
  const labels = {
    mastered: 'Mastered',
    functional: 'Functional',
    partial: 'Partial',
    unstable: 'Unstable',
    active: 'Active',
    locked: 'Locked',
  };
  return (
    <span className={`state-pill ${state}`}>
      <span className={`pdot ${state}`} />
      {labels[state]}
    </span>
  );
}

function DifficultyBars({ value }) {
  return (
    <span className="diff-bars" title={`Difficulty ${value}/5`}>
      {[1,2,3,4,5].map(i => <i key={i} className={i <= value ? 'on' : ''} />)}
    </span>
  );
}

function ImportanceStack({ value }) {
  return (
    <span className="imp-stack" title={`Importance ${value}/3`}>
      {[1,2,3].map(i => <i key={i} className={i <= value ? 'on' : ''} />)}
    </span>
  );
}

window.StatePill = StatePill;
window.DifficultyBars = DifficultyBars;
window.ImportanceStack = ImportanceStack;
