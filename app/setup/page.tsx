import Link from 'next/link'
import { TopicInput } from '@/components/setup/TopicInput'
import { BackButton } from '@/components/navigation/BackButton'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'

export default function SetupPage({ searchParams }: { searchParams?: { job?: string } }) {
  const initialJobId = searchParams?.job || null

  return (
    <main className="setup-page">
      <header className="topbar">
        <div className="topbar-left">
          <BackButton fallbackHref="/" />
          <Link className="brand" href="/" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <TruLurnLogo size={22} />
            <span>TruLurn</span>
          </Link>
        </div>
      </header>
      <div className="setup-page-header">
        <p className="eyebrow">New course</p>
        <h1 className="page-heading">Build a curriculum</h1>
        <p className="page-subtitle">
          Five quick decisions shape the whole course. Everything except the goal can be changed later.
        </p>
      </div>
      <TopicInput initialJobId={initialJobId} />
    </main>
  )
}
