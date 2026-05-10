'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import BoardClient from '@/components/BoardClient'

// Phase 6 root gate — client-side per design.md §5.1.
//
// Rationale (locked decision; do not re-litigate): better-auth sets the
// session cookie on Railway with SameSite=None; Secure; Partitioned and no
// Domain attribute, so it is host-only on *.up.railway.app. The browser
// never sends it on top-level navigations to *.vercel.app, so a Vercel
// server-component cannot validate the session via cookies(). It DOES send
// it on cross-origin XHR with credentials:'include', which is what
// authClient.useSession() does under the hood. So we gate in the browser.
//
// useSession() initial atom state (better-auth 1.6.10, query.mjs:5-11) is
// { data: null, isPending: true } — i.e. data is null while loading. We
// MUST guard on isPending before deciding to redirect, otherwise every
// cold mount races to /login.
//
// router.replace must be called inside useEffect (cannot mutate router
// during render in Next 16 / React 19 strict mode); we early-return a
// skeleton while the effect is queued.

export default function RootPage() {
  const router = useRouter()
  const { data, isPending } = authClient.useSession()

  // H-NEW-1 fix. Earlier draft used compound boolean aliases (`noSession`,
  // `noActiveOrg`) for both the effect deps and the render guard. TS 4.4+
  // aliased-condition narrowing handles only *simple* discriminant aliases
  // and does NOT propagate through compound boolean aliases — so the final
  // `data.session.activeOrganizationId` and `data.user.email` reads still
  // emitted TS18047 ("'data' is possibly 'null'"), and a non-null assertion
  // would have masked only the inner `?: string`. Inline conditions narrow
  // natively, so the non-null assertion is no longer needed.
  useEffect(() => {
    if (isPending) return
    if (data === null) {
      router.replace('/login')
      return
    }
    if (data.session.activeOrganizationId == null) {
      router.replace('/onboarding')
    }
  }, [isPending, data, router])

  if (isPending || data === null) {
    // Non-flashing skeleton (R8.1.2). No board chrome, no "/login" link, no
    // text — just bg-bg so any paint that occurs reads as a continuation of
    // the next route's background. Sub-200ms on warm cache; cap is 1s on
    // slow 3G (see R-RG-1' below).
    return <main className="min-h-screen bg-bg" aria-busy="true" />
  }
  if (data.session.activeOrganizationId == null) {
    // Same skeleton — the effect above will router.replace('/onboarding').
    return <main className="min-h-screen bg-bg" aria-busy="true" />
  }

  // TS narrows `data` to non-null after the first guard and
  // `activeOrganizationId` to `string` after the `== null` guard (which
  // covers both `null` and `undefined`). No non-null assertion needed.
  return (
    <BoardClient
      orgId={data.session.activeOrganizationId}
      userEmail={data.user.email}
    />
  )
}
