'use client'

import { Suspense, useActionState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

type AuthFormState = { error: string | null } | null

// Same-origin guard: accept ONLY paths starting with '/' that are NOT '//' (OWASP open-redirect).
function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  return raw
}

function SignupInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next')
  const target = safeNext(next) ?? '/onboarding'
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

  const [state, formAction, isPending] = useActionState<AuthFormState, FormData>(
    async (_prev, formData) => {
      const email = String(formData.get('email') ?? '')
      const password = String(formData.get('password') ?? '')
      const name = String(formData.get('name') ?? '')
      const { error } = await authClient.signUp.email({ email, password, name })
      if (error) return { error: error.message ?? 'Sign-up failed' }
      // M-2: Routes through Next router; do NOT swap to window.location.href without re-auditing safeNext.
      router.push(target)
      return { error: null }
    },
    null
  )

  return (
    <form
      action={formAction}
      className="bg-surface p-8 rounded-lg border border-border shadow-sm w-full max-w-sm"
    >
      <h1 className="text-[18px] font-semibold tracking-[0.02em] text-text mb-6">Create account</h1>

      <label className="block text-[12px] font-medium text-text-muted mb-1" htmlFor="name">Name</label>
      <input
        id="name"
        name="name"
        type="text"
        required
        autoComplete="name"
        className="block w-full mb-4 px-3 py-2 rounded border border-border bg-bg text-text text-[14px] outline-none focus:border-accent"
      />

      <label className="block text-[12px] font-medium text-text-muted mb-1" htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        className="block w-full mb-4 px-3 py-2 rounded border border-border bg-bg text-text text-[14px] outline-none focus:border-accent"
      />

      <label className="block text-[12px] font-medium text-text-muted mb-1" htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        className="block w-full mb-6 px-3 py-2 rounded border border-border bg-bg text-text text-[14px] outline-none focus:border-accent"
      />

      <button
        type="submit"
        disabled={isPending}
        className="w-full px-4 py-2 rounded bg-accent text-white text-[14px] font-medium hover:bg-accent-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? 'Create account…' : 'Create account'}
      </button>

      {state?.error ? (
        <p className="text-red-700 text-[13px] mt-2" role="alert">{state.error}</p>
      ) : null}

      <p className="text-[13px] text-text-muted mt-6">
        Already have an account?{' '}
        <Link href={loginHref} className="text-accent hover:text-accent-2 underline">Sign in</Link>
      </p>
    </form>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupInner />
    </Suspense>
  )
}
