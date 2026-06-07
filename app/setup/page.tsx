import Link from 'next/link'
import { TopicInput } from '@/components/setup/TopicInput'
import { BackButton } from '@/components/navigation/BackButton'

export default function SetupPage({ searchParams }: { searchParams?: { job?: string } }) {
  const initialJobId = searchParams?.job || null

  return (
    <main className="setup-page">
      <header className="topbar">
        <div className="topbar-left">
          <BackButton fallbackHref="/" />
          <Link className="brand" href="/">
            TruLurn
          </Link>
        </div>
        <Link className="button-subtle" href="/">Home</Link>
      </header>
      <div style={{ marginTop: 34 }}>
        <h1 className="page-heading">Build a curriculum</h1>
        <p className="page-subtitle">Choose the learning scope. The generated Atlas is stored first, then opened in its dedicated course workspace.</p>
      </div>
      <TopicInput initialJobId={initialJobId} />
    </main>
  )
}
