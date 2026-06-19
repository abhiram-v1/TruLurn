import Link from 'next/link'
import { BottomNav } from '@/components/navigation/BottomNav'
import { AuthButtons } from '@/components/auth/AuthButtons'
import { BackButton } from '@/components/navigation/BackButton'
import { TruLurnLogo } from '@/components/ui/TruLurnLogo'

export function AppFrame({
  children,
  courseId,
  title,
  action,
  backFallback,
  contentClassName,
}: {
  children: React.ReactNode
  courseId?: string
  title?: string
  action?: React.ReactNode
  backFallback?: string
  contentClassName?: string
}) {
  return (
    <div className="product-shell">
      <header className="product-topbar">
        <div className="topbar-left">
          <BackButton fallbackHref={backFallback ?? (courseId ? `/course/${courseId}` : '/')} />
          <Link className="brand" href="/" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <TruLurnLogo size={22} />
            <span>TruLurn</span>
          </Link>
        </div>
        {title ? <div className="topbar-title">{title}</div> : null}
        <div className="topbar-actions">
          {action}
          <AuthButtons />
        </div>
      </header>
      <div className={`product-content${contentClassName ? ` ${contentClassName}` : ''}`}>{children}</div>
      <BottomNav courseId={courseId} />
    </div>
  )
}
