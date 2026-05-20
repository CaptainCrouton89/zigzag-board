'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  // Same eager-validation policy as auth-client.ts.
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

type AcceptState = 'pending' | 'invalid' | 'error'

interface InvitePageProps {
  // Next 16 contract: dynamic-segment params arrive as a Promise.
  // Client components unwrap with React 19's `use()` (NOT `await` — client
  // components cannot be async functions).
  params: Promise<{ code: string }>
}

export default function InvitePage({ params }: InvitePageProps) {
  const { code } = use(params)
  const router = useRouter()
  const { data, isPending, refetch } = authClient.useSession()
  const [state, setState] = useState<AcceptState>('pending')
  // Strict-mode double-effect guard — the accept POST is non-idempotent
  // (well, server-side it IS idempotent per Phase-3 R4.1.4, but firing twice
  // on dev still wastes a Railway round trip and surfaces in logs).
  const firedRef = useRef(false)

  useEffect(() => {
    if (isPending) return
    if (data === null) {
      router.replace(`/login?next=/invite/${encodeURIComponent(code)}`)
      return
    }
    if (firedRef.current) return
    firedRef.current = true

    let cancelled = false
    ;(async () => {
      try {
        // Browser-direct fetch with credentials:'include'. The browser
        // attaches Railway's Partitioned session cookie automatically on
        // this cross-origin XHR — no manual `Cookie:` header forwarding.
        const res = await fetch(
          `${API_URL}/api/invite/${encodeURIComponent(code)}/accept`,
          { method: 'POST', credentials: 'include' }
        )
        if (cancelled) return
        if (res.status === 401) {
          // Stale or missing cookie — funnel through /login.
          router.replace(`/login?next=/invite/${encodeURIComponent(code)}`)
          return
        }
        if (res.status === 404) {
          setState('invalid')
          return
        }
        if (!res.ok) {
          setState('error')
          return
        }
        // Phase-3 returns 200 with { organizationId } on both fresh-accept
        // and idempotent already-member. Either way: drop on the board.
        // Refresh the session atom first — the server set
        // activeOrganizationId on the cookie, but the atom doesn't auto-
        // refresh for direct fetches (only authClient.organization.* paths
        // trigger atomListeners in better-auth's organization client), so
        // RootPage would otherwise read null and bounce back to /onboarding.
        await refetch()
        router.push('/')
      } catch {
        if (!cancelled) setState('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isPending, data, code, router])

  if (state === 'invalid') {
    return <InviteShell><InviteError code={code} title="Invite link is invalid" /></InviteShell>
  }
  if (state === 'error') {
    return <InviteShell><InviteError code={code} title="Could not join organization" /></InviteShell>
  }
  // 'pending' covers both "useSession loading" and "accept-fetch in flight".
  // Render the same non-flashing skeleton shape the root gate uses.
  return <main className="min-h-screen bg-bg" aria-busy="true" />
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

function InviteError({ code, title }: { code: string; title: string }) {
  return (
    <div className="flex flex-col gap-4 bg-surface border border-border rounded-lg p-6 shadow-sm">
      <h1 className="text-base font-semibold text-text">{title}</h1>
      <p className="text-[13px] text-text-muted">Code: <code className="font-mono">{code}</code></p>
      <Link
        href="/onboarding"
        className="px-3 py-2 rounded bg-accent text-white text-sm font-medium text-center"
      >
        Back to onboarding
      </Link>
    </div>
  )
}
