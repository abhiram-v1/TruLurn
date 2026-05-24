'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'

export function AuthButtons() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return <div className="auth-loading" aria-hidden="true" />
  }

  if (session?.user) {
    return (
      <div className="auth-user-menu">
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt={session.user.name ?? 'User avatar'}
            width={30}
            height={30}
            className="auth-avatar"
          />
        ) : (
          <div className="auth-avatar-placeholder" aria-hidden="true">
            {session.user.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
        )}
        <button
          className="button-quiet auth-signout-btn"
          onClick={() => signOut({ callbackUrl: '/' })}
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="auth-cta-row">
      <Link className="button-subtle" href="/auth/signin">
        Sign in
      </Link>
      <Link className="button" href="/auth/signin">
        Sign up
      </Link>
    </div>
  )
}
