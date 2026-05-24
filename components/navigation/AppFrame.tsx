import Link from 'next/link'
import { BottomNav } from '@/components/navigation/BottomNav'
import { AuthButtons } from '@/components/auth/AuthButtons'

export function AppFrame({
  children,
  courseId = 'course-ml',
  title,
  action,
}: {
  children: React.ReactNode
  courseId?: string
  title?: string
  action?: React.ReactNode
}) {
  return (
    <div className="product-shell">
      <header className="product-topbar">
        <Link className="brand" href="/">TruLurn</Link>
        {title ? <div className="topbar-title">{title}</div> : null}
        <div className="topbar-actions">
          {action}
          <AuthButtons />
        </div>
      </header>
      <div className="product-content">{children}</div>
      <BottomNav courseId={courseId} />
    </div>
  )
}
