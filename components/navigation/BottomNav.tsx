import Link from 'next/link'

export function BottomNav({ courseId = 'course-ml' }: { courseId?: string }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <Link className="bottom-nav-item" href="/">
        <span className="nav-icon" aria-hidden="true">H</span>
        <span>Home</span>
      </Link>
      <Link className="bottom-nav-item" href={`/graph/${courseId}`}>
        <span className="nav-icon" aria-hidden="true">G</span>
        <span>Graph</span>
      </Link>
      <Link className="bottom-nav-item" href="/settings">
        <span className="nav-icon" aria-hidden="true">S</span>
        <span>Settings</span>
      </Link>
    </nav>
  )
}
