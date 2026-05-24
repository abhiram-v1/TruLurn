import Link from 'next/link'
import { TopicInput } from '@/components/setup/TopicInput'

export default function SetupPage() {
  return (
    <main className="setup-page">
      <header className="topbar">
        <Link className="brand" href="/">
          TruLurn
        </Link>
        <Link className="button-subtle" href="/">
          Home
        </Link>
      </header>
      <div style={{ marginTop: 34 }}>
        <h1 className="page-heading">Build a curriculum</h1>
        <p className="page-subtitle">Choose the learning scope. The generated roadmap is stored first, then opened in its dedicated course workspace.</p>
      </div>
      <TopicInput />
    </main>
  )
}
