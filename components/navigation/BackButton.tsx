'use client'

import { IconChevronLeft } from '@tabler/icons-react'
import { useRouter } from 'next/navigation'

export function BackButton({
  fallbackHref = '/',
  label = 'Back',
  className = 'back-button',
}: {
  fallbackHref?: string
  label?: string
  className?: string
}) {
  const router = useRouter()

  return (
    <button
      className={className}
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(fallbackHref)
      }}
      aria-label={label}
      title={label}
    >
      <IconChevronLeft aria-hidden="true" size={16} stroke={2} />
      <span>{label}</span>
    </button>
  )
}
