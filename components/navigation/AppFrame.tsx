import Link from 'next/link'
import { BottomNav } from '@/components/navigation/BottomNav'
import { AuthButtons } from '@/components/auth/AuthButtons'
import { BackButton } from '@/components/navigation/BackButton'

export function AppFrame({
  children,
  courseId,
  title,
  action,
  backFallback,
}: {
  children: React.ReactNode
  courseId?: string
  title?: string
  action?: React.ReactNode
  backFallback?: string
}) {
  return (
    <div className="product-shell">
      <header className="product-topbar">
        <div className="topbar-left">
          <BackButton fallbackHref={backFallback ?? (courseId ? `/course/${courseId}` : '/')} />
          <Link className="brand" href="/">TruLurn</Link>
        </div>
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
