'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  // Fail loudly at module load — same eager-validation policy as auth-client.ts.
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

type Created = { inviteUrl: string } | null

export default function OnboardingPage() {
  const router = useRouter()
  // The server endpoints below mutate session.activeOrganizationId via
  // better-auth's server API, but the client-side session atom only auto-
  // refreshes through atomListeners on authClient.organization.* paths
  // (client.mjs:65-93). Direct fetch to our own /api/org bypasses those, so
  // useSession() data stays stale — and RootPage redirects right back to
  // /onboarding when activeOrganizationId still reads null. Capture refetch
  // here and await it before any router.push('/').
  const { refetch } = authClient.useSession()

  // Create-org panel state
  const [orgName, setOrgName] = useState('')
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created>(null)
  const [copied, setCopied] = useState(false)

  // Paste-invite panel state
  const [inviteInput, setInviteInput] = useState('')
  const [joinPending, setJoinPending] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (createPending) return
    setCreateError(null)
    const name = orgName.trim()
    if (!name) {
      setCreateError('Enter an organization name')
      return
    }
    setCreatePending(true)
    try {
      const res = await fetch(`${API_URL}/api/org`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.status === 401) {
        // MINOR-1: gate-driven redirect (server rejected the session) — replace,
        // not push, per the slice rule below ("router.replace for redirects
        // driven by gate state").
        router.replace('/login?next=/onboarding')
        return
      }
      if (!res.ok) {
        // Phase-3 contract: non-2xx returns JSON { error: string }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setCreateError(body.error ?? 'Could not create organization')
        return
      }
      // H-2: runtime-checked parse. Phase-3 returns 201 with
      // { organizationId, inviteUrl }, but if the contract ever drifts (server
      // bug emits a different shape, or the response isn't JSON), an unguarded
      // cast would silently set inviteUrl=undefined and a Copy-button click
      // would copy the literal string "undefined". Surface the failure instead.
      const body = (await res.json().catch(() => null)) as
        | { organizationId?: string; inviteUrl?: string }
        | null
      if (!body?.inviteUrl) {
        setCreateError('Server returned an unexpected response')
        return
      }
      setCreated({ inviteUrl: body.inviteUrl })
      // Kick off a session refetch so the atom has the new
      // activeOrganizationId before the user clicks "Go to board". Fire-and-
      // forget here is fine — the button's onClick awaits a fresh refetch
      // too, so this is a latency optimization, not a correctness gate.
      void refetch()
    } catch {
      setCreateError('Network error')
    } finally {
      setCreatePending(false)
    }
  }

  async function onCopy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Insecure context or permission denied. Select the input as a fallback
      // and let the user copy manually with the OS shortcut.
      const el = document.getElementById('invite-url-input') as HTMLInputElement | null
      el?.select()
      setCopied(false)
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault()
    if (joinPending) return
    setJoinError(null)
    // Parse: try as URL first; on parse-fail, treat trimmed input as the code.
    let code: string
    try {
      const u = new URL(inviteInput)
      code = u.pathname.split('/').filter(Boolean).pop() ?? ''
    } catch {
      code = inviteInput.trim()
    }
    if (!code) {
      setJoinError('Enter an invite link or code')
      return
    }
    setJoinPending(true)
    try {
      const res = await fetch(`${API_URL}/api/invite/${encodeURIComponent(code)}/accept`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.status === 401) {
        // MINOR-1: gate-driven redirect — replace, not push.
        router.replace(`/login?next=/onboarding`)
        return
      }
      if (res.status === 404) {
        setJoinError('Invite link is invalid')
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setJoinError(body.error ?? 'Could not join organization')
        return
      }
      // Refresh session atom so RootPage sees the new activeOrganizationId
      // and doesn't bounce back here. See refetch note at the top of this
      // component for the underlying reason.
      await refetch()
      router.push('/')
    } catch {
      setJoinError('Network error')
    } finally {
      setJoinPending(false)
    }
  }

  // H-1: outer wrapper centers the panels on the viewport. Root layout is a
  // plain `min-h-full flex flex-col` body that does NOT center children, so
  // this wrapper is unconditional (NOT a contingency) — without it, the
  // panels would left-align in the viewport.
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md flex flex-col gap-6">
        {/* Create-org panel */}
        <section className="bg-surface border border-border rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-semibold text-text mb-1">Create a new organization</h2>
          <p className="text-[13px] text-text-muted mb-4">You become the owner. Invite link appears below.</p>
          {!created ? (
            <form onSubmit={onCreate} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[13px] text-text-muted">
                Organization name
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={createPending}
                  autoFocus
                  className="px-3 py-2 rounded border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={createPending}
                className="px-3 py-2 rounded bg-accent text-white text-sm font-medium disabled:opacity-60"
              >
                {createPending ? 'Creating organization…' : 'Create organization'}
              </button>
              {createError && (
                <p role="alert" className="text-[13px] text-red-700">{createError}</p>
              )}
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[13px] text-text-muted">
                Invite link
                <input
                  id="invite-url-input"
                  type="text"
                  readOnly
                  value={created.inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="px-3 py-2 rounded border border-border bg-bg-soft text-text text-sm font-mono"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCopy}
                  className="px-3 py-2 rounded border border-border bg-bg text-text text-sm"
                >
                  {copied ? 'Copied' : 'Copy invite link'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    // Belt-and-suspenders: the post-create fire-and-forget
                    // refetch usually completes well before the user clicks
                    // here, but await one more time so navigation cannot
                    // race the atom update and bounce back to /onboarding.
                    await refetch()
                    router.push('/')
                  }}
                  className="px-3 py-2 rounded bg-accent text-white text-sm font-medium"
                >
                  Go to board
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Paste-invite panel */}
        <section className="bg-surface border border-border rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-semibold text-text mb-1">Or join with an invite link</h2>
          <p className="text-[13px] text-text-muted mb-4">Paste a full link or just the code.</p>
          <form onSubmit={onJoin} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] text-text-muted">
              Invite link or code
              <input
                type="text"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                disabled={joinPending}
                placeholder="https://… /invite/abc123 or abc123"
                className="px-3 py-2 rounded border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={joinPending}
              className="px-3 py-2 rounded border border-border bg-bg text-text text-sm font-medium disabled:opacity-60"
            >
              {joinPending ? 'Joining organization…' : 'Join organization'}
            </button>
            {joinError && (
              <p role="alert" className="text-[13px] text-red-700">{joinError}</p>
            )}
          </form>
        </section>
      </div>
    </div>
  )
}
