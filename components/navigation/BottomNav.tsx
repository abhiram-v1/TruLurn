'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { IconHome, IconListCheck, IconMap, IconSettings, IconTopologyStar3 } from '@tabler/icons-react'

function navClass(pathname: string, href: string, exact = false) {
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
  return active ? 'bottom-nav-item active' : 'bottom-nav-item'
}

export function BottomNav({ courseId }: { courseId?: string }) {
  const pathname = usePathname() ?? ''
  const atlasHref = courseId ? `/course/${courseId}` : '/'
  const graphHref = courseId ? `/graph/${courseId}` : '/'
  const quizzesHref = courseId ? `/course/${courseId}/quizzes` : '/'

  return (
    <nav className="bottom-nav" aria-label="Primary">
      <Link className={navClass(pathname, '/', true)} href="/">
        <span className="nav-icon" aria-hidden="true"><IconHome size={14} stroke={1.8} /></span>
        <span>Home</span>
      </Link>
      <Link className={navClass(pathname, atlasHref, true)} href={atlasHref}>
        <span className="nav-icon" aria-hidden="true"><IconMap size={14} stroke={1.8} /></span>
        <span>Atlas</span>
      </Link>
      <Link className={navClass(pathname, graphHref)} href={graphHref}>
        <span className="nav-icon" aria-hidden="true"><IconTopologyStar3 size={14} stroke={1.8} /></span>
        <span>Graph</span>
      </Link>
      <Link className={navClass(pathname, quizzesHref)} href={quizzesHref}>
        <span className="nav-icon" aria-hidden="true"><IconListCheck size={14} stroke={1.8} /></span>
        <span>Quizzes</span>
      </Link>
      <Link className={navClass(pathname, '/settings')} href="/settings">
        <span className="nav-icon" aria-hidden="true"><IconSettings size={14} stroke={1.8} /></span>
        <span>Settings</span>
      </Link>
    </nav>
  )
}
