'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  // Match auth-client.ts eager-validation policy.
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

// Outer page wraps in Suspense because useSearchParams suspends during
// hydration. Without it, Next 16 throws a build-time hint to add Suspense.
export default function CliAuthorizePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-bg" aria-busy="true" />}>
      <CliAuthorizeInner />
    </Suspense>
  )
}

type Phase = 'idle' | 'submitting' | 'approved' | 'denied' | 'error'

function CliAuthorizeInner() {
  const router = useRouter()
  const params = useSearchParams()
  const codeParam = params.get('code')
  const initialCode = typeof codeParam === 'string' ? codeParam : ''
  const { data, isPending } = authClient.useSession()

  const [code, setCode] = useState(initialCode.trim().toUpperCase())
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Funnel unauthenticated users through login, returning here afterward.
  // Strict-mode renders the effect twice in dev; the redirect is idempotent
  // so no firedRef guard is needed.
  useEffect(() => {
    if (isPending) return
    if (data === null) {
      const next = encodeURIComponent(`/cli/authorize?code=${encodeURIComponent(initialCode)}`)
      router.replace(`/login?next=${next}`)
    }
  }, [isPending, data, initialCode, router])

  async function submit(action: 'approve' | 'deny') {
    if (phase === 'submitting') return
    const userCode = code.trim().toUpperCase()
    if (!userCode) {
      setErrorMessage('Enter the code shown in your terminal')
      setPhase('error')
      return
    }
    setPhase('submitting')
    setErrorMessage(null)
    try {
      const res = await fetch(`${API_URL}/api/cli/auth/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode }),
      })
      if (res.status === 401) {
        const next = encodeURIComponent(`/cli/authorize?code=${encodeURIComponent(userCode)}`)
        router.replace(`/login?next=${next}`)
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        const code = body.error
        if (code === 'unknown_code') setErrorMessage('Code not recognized — check your terminal')
        else if (code === 'expired') setErrorMessage('This code has expired — start over with `zigzag login`')
        else if (code === 'already_used') setErrorMessage('This code has already been used')
        else setErrorMessage('Could not authorize — please try again')
        setPhase('error')
        return
      }
      setPhase(action === 'approve' ? 'approved' : 'denied')
    } catch {
      setErrorMessage('Network error')
      setPhase('error')
    }
  }

  if (isPending || data === null) {
    return <main className="min-h-screen bg-bg" aria-busy="true" />
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        <section className="bg-surface border border-border rounded-lg p-6 shadow-sm flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h1 className="text-base font-semibold text-text">Authorize the Zigzag CLI</h1>
            <p className="text-[13px] text-text-muted">
              A device wants to connect to your account. Approve only if the
              code below matches what your terminal shows.
            </p>
          </header>

          {phase === 'approved' ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text">Device approved.</p>
              <p className="text-[13px] text-text-muted">
                You can return to your terminal — the CLI will finish signing in
                automatically.
              </p>
            </div>
          ) : phase === 'denied' ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text">Request denied.</p>
              <p className="text-[13px] text-text-muted">
                The CLI will report that authorization was rejected.
              </p>
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-[13px] text-text-muted">
                Verification code
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  disabled={phase === 'submitting'}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="text"
                  className="px-3 py-2 rounded border border-border bg-bg text-text text-sm font-mono tracking-widest focus:outline-none focus:border-accent"
                  placeholder="ABCD-EFGH"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => submit('approve')}
                  disabled={phase === 'submitting'}
                  className="px-3 py-2 rounded bg-accent text-white text-sm font-medium disabled:opacity-60 grow"
                >
                  {phase === 'submitting' ? 'Authorizing…' : 'Approve'}
                </button>
                <button
                  type="button"
                  onClick={() => submit('deny')}
                  disabled={phase === 'submitting'}
                  className="px-3 py-2 rounded border border-border bg-bg text-text text-sm"
                >
                  Deny
                </button>
              </div>
              {errorMessage && (
                <p role="alert" className="text-[13px] text-red-700">{errorMessage}</p>
              )}
            </>
          )}

          <p className="text-[12px] text-text-muted">
            Signed in as{' '}
            <span className="font-mono text-text">{data.user.email}</span>
          </p>
        </section>
      </div>
    </div>
  )
}
