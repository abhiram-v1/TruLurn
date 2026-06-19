'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const MIN_VISIBLE_MS = 280

export function NavigationFeedback() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeKey = `${pathname ?? ''}?${searchParams?.toString() ?? ''}`
  const [visible, setVisible] = useState(false)
  const startedAt = useRef(0)
  const startedRoute = useRef(routeKey)
  const hideTimer = useRef<number | null>(null)
  const safetyTimer = useRef<number | null>(null)

  useEffect(() => {
    function start() {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      if (safetyTimer.current) window.clearTimeout(safetyTimer.current)
      startedAt.current = performance.now()
      startedRoute.current = `${window.location.pathname}?${window.location.search.replace(/^\?/, '')}`
      setVisible(true)
      safetyTimer.current = window.setTimeout(() => setVisible(false), 15000)
    }

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      if (`${destination.pathname}${destination.search}` === `${window.location.pathname}${window.location.search}`) return
      start()
    }

    document.addEventListener('click', handleClick, true)
    window.addEventListener('popstate', start)
    return () => {
      document.removeEventListener('click', handleClick, true)
      window.removeEventListener('popstate', start)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      if (safetyTimer.current) window.clearTimeout(safetyTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!visible || routeKey === startedRoute.current) return
    const elapsed = performance.now() - startedAt.current
    hideTimer.current = window.setTimeout(
      () => {
        setVisible(false)
        if (safetyTimer.current) window.clearTimeout(safetyTimer.current)
      },
      Math.max(0, MIN_VISIBLE_MS - elapsed),
    )
  }, [routeKey, visible])

  return (
    <div
      className={`navigation-feedback${visible ? ' is-visible' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={visible ? 'Loading page' : undefined}
    >
      <span className="navigation-feedback-bar" />
      <span className="navigation-feedback-wheel" aria-hidden="true" />
    </div>
  )
}
