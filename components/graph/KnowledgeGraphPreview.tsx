import { mockTopics } from '@/lib/mock-data'

export function KnowledgeGraphPreview() {
  const nodes = mockTopics.slice(0, 7)

  return (
    <section className="graph-canvas" aria-label="Knowledge graph preview">
      <div className="graph-note">
        Reflection view. Not navigation. Updates only after quiz, topic completion, or session summary.
      </div>
      <div className="graph-board">
        {nodes.map((topic, index) => (
          <div className={`graph-node node-${index + 1} ${topic.state}`} key={topic.id}>
            <span className={`state-dot ${topic.state}`} />
            {topic.title}
          </div>
        ))}
        <div className="graph-edge edge-1" />
        <div className="graph-edge edge-2" />
        <div className="graph-edge edge-3 weak" />
        <div className="graph-edge edge-4" />
      </div>
    </section>
  )
}
