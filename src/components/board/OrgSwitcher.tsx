'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  // Same eager-validation policy as auth-client.ts / onboarding/page.tsx.
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

interface OrgItem {
  id: string
  name: string
  slug: string
  role: string
}

interface Props {
  activeOrgId: string
  activeOrgName: string
}

// Why a full window.location.reload after switch instead of letting useSession
// re-render: the y.js provider in `useBoard` is keyed on orgId via a module-
// scoped refcounted cache (sync.ts), and BoardClient mounts a number of
// effects that depend on the initial orgId render. Forcing a hard reload after
// the server flips `session.activeOrganizationId` is the safest path through
// the seed-overwrite guard, the ID-counter sync, and the provider teardown —
// matches the project's existing post-mutation-redirect pattern.
function reloadToBoard() {
  window.location.assign('/')
}

export function OrgSwitcher({ activeOrgId, activeOrgName }: Props) {
  const [open, setOpen] = useState(false)
  const [orgs, setOrgs] = useState<OrgItem[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null) // org id being switched to
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteInput, setInviteInput] = useState('')
  const [joinPending, setJoinPending] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setInviteOpen(false)
    setInviteInput('')
    setJoinError(null)
  }, [])

  // Anchor the panel below the trigger; track on resize/scroll.
  useEffect(() => {
    if (!open) return
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({ left: rect.left, top: rect.bottom + 6 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // Outside-click + Escape to close.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  // Lazy-fetch org list on first open. Refetch on each open is overkill — a
  // newly-joined org appears via reload anyway, so cache for the panel session.
  useEffect(() => {
    if (!open || orgs !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/api/org/me`, { credentials: 'include' })
        if (cancelled) return
        if (!res.ok) {
          setListError('Could not load organizations')
          return
        }
        const body = (await res.json()) as { orgs?: OrgItem[] }
        if (!Array.isArray(body.orgs)) {
          setListError('Server returned an unexpected response')
          return
        }
        setOrgs(body.orgs)
      } catch {
        if (!cancelled) setListError('Network error')
      }
    })()
    return () => { cancelled = true }
  }, [open, orgs])

  const onSelect = useCallback(async (id: string) => {
    if (id === activeOrgId || pending) return
    setPending(id)
    try {
      const res = await fetch(`${API_URL}/api/org/${encodeURIComponent(id)}/select`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        setListError('Could not switch organization')
        setPending(null)
        return
      }
      reloadToBoard()
    } catch {
      setListError('Network error')
      setPending(null)
    }
  }, [activeOrgId, pending])

  const onJoin = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (joinPending) return
    setJoinError(null)
    // Accept either a full invite URL or just the code (matches onboarding parse).
    let code = ''
    try {
      const u = new URL(inviteInput)
      const last = u.pathname.split('/').filter(Boolean).pop()
      if (last) code = last
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
      if (res.status === 404) {
        setJoinError('Invite link is invalid')
        setJoinPending(false)
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setJoinError(body.error ?? 'Could not join organization')
        setJoinPending(false)
        return
      }
      // Server already setActiveOrganization on accept — reload picks up.
      reloadToBoard()
    } catch {
      setJoinError('Network error')
      setJoinPending(false)
    }
  }, [inviteInput, joinPending])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Active org: ${activeOrgName}`}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-muted hover:bg-bg-soft hover:text-text border border-border"
      >
        <span className="truncate max-w-[160px]">{activeOrgName}</span>
        <span aria-hidden className="text-[9px] leading-none">▾</span>
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="fixed rounded-xl border border-border bg-surface p-2 flex flex-col gap-1 text-sm"
          style={{
            left: pos.left,
            top: pos.top,
            width: 280,
            boxShadow: 'var(--shadow-2)',
            zIndex: 2000,
          }}
        >
          <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wide text-text-dim">
            Switch organization
          </div>
          {orgs === null && !listError && (
            <div className="px-2 py-2 text-[12.5px] text-text-muted">Loading…</div>
          )}
          {listError && (
            <div role="alert" className="px-2 py-2 text-[12.5px] text-red-700">{listError}</div>
          )}
          {orgs && orgs.length === 0 && !listError && (
            <div className="px-2 py-2 text-[12.5px] text-text-muted">No organizations yet.</div>
          )}
          {orgs && orgs.map(o => {
            const isActive = o.id === activeOrgId
            const isPending = pending === o.id
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                disabled={isActive || pending !== null}
                onClick={() => onSelect(o.id)}
                className={[
                  'flex items-center justify-between gap-2 px-2 py-[6px] rounded-md text-left',
                  isActive
                    ? 'text-text cursor-default bg-bg-soft'
                    : 'text-text-muted hover:bg-bg-soft hover:text-text cursor-pointer',
                  pending && !isPending ? 'opacity-50' : '',
                ].join(' ')}
              >
                <span className="flex-1 min-w-0 truncate text-[13px]">{o.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-text-dim shrink-0">
                  {isPending ? 'switching…' : isActive ? 'active' : o.role}
                </span>
              </button>
            )
          })}

          <div className="my-1 h-px bg-border" />

          {!inviteOpen ? (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="px-2 py-[6px] rounded-md text-left text-[12.5px] text-text-muted hover:bg-bg-soft hover:text-text"
            >
              Join via invite link…
            </button>
          ) : (
            <form onSubmit={onJoin} className="flex flex-col gap-2 p-1">
              <input
                type="text"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                disabled={joinPending}
                autoFocus
                placeholder="https://… /invite/abc123 or abc123"
                className="px-2 py-[6px] rounded border border-border bg-bg text-text text-[12.5px] focus:outline-none focus:border-accent"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={joinPending}
                  className="flex-1 px-2 py-[6px] rounded bg-accent text-white text-[12.5px] font-medium disabled:opacity-60"
                >
                  {joinPending ? 'Joining…' : 'Join'}
                </button>
                <button
                  type="button"
                  onClick={() => { setInviteOpen(false); setInviteInput(''); setJoinError(null) }}
                  disabled={joinPending}
                  className="px-2 py-[6px] rounded border border-border bg-bg text-text-muted text-[12.5px] hover:text-text"
                >
                  Cancel
                </button>
              </div>
              {joinError && (
                <p role="alert" className="text-[12px] text-red-700">{joinError}</p>
              )}
            </form>
          )}

          <Link
            href="/settings?tab=organization"
            onClick={close}
            className="px-2 py-[6px] rounded-md text-left text-[12.5px] text-text-muted hover:bg-bg-soft hover:text-text"
          >
            Manage organization →
          </Link>
          <Link
            href="/onboarding"
            onClick={close}
            className="px-2 py-[6px] rounded-md text-left text-[12.5px] text-text-muted hover:bg-bg-soft hover:text-text"
          >
            Create new organization →
          </Link>
        </div>,
        document.body,
      )}
    </>
  )
}
