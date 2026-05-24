import Link from 'next/link'
import { KnowledgeGraphPreview } from '@/components/graph/KnowledgeGraphPreview'
import { AppFrame } from '@/components/navigation/AppFrame'

export default function GraphPage({ params }: { params: { courseId: string } }) {
  return (
    <AppFrame
      courseId={params.courseId}
      title="Knowledge graph"
      action={<Link className="button-subtle" href={`/course/${params.courseId}`}>Big roadmap</Link>}
    >
      <main className="graph-page">
        <div className="page-header narrow">
          <p className="eyebrow">Reflection view</p>
          <h1 className="page-heading">Connections are evidence-based, not guessed live.</h1>
          <p className="page-subtitle">
            The graph shows structural dependencies and demonstrated connection strength. It is not used as active study navigation.
          </p>
        </div>
        <KnowledgeGraphPreview />
      </main>
    </AppFrame>
  )
}
