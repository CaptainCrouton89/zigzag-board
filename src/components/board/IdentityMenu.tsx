'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

interface Props {
  userEmail: string
  onSignOut: () => void | Promise<void>
}

// Identity affordance for the board header. Replaces the bare email chip +
// Sign-out button with a single trigger that opens a small menu: Settings,
// Sign out. Mirrors OrgSwitcher's portal-anchored popover pattern so it
// escapes the board's overflow-hidden ancestors and feels like part of the
// same surface family.
export function IdentityMenu({ userEmail, onSignOut }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Display initial: first character of the local part, uppercased. Fallback
  // to '?' so a degenerate email never produces an empty avatar circle.
  const initial = (() => {
    const head = userEmail.trim().charAt(0).toUpperCase()
    return head.length > 0 ? head : '?'
  })()

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({ left: rect.right - 220, top: rect.bottom + 6 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  async function handleSignOut() {
    close()
    await onSignOut()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={userEmail}
        className="w-[28px] h-[28px] rounded-full border border-border bg-bg-soft text-[11.5px] font-medium text-text-muted hover:text-text hover:border-border-strong transition-colors flex items-center justify-center"
      >
        {initial}
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="fixed rounded-xl border border-border bg-surface p-1 flex flex-col gap-[2px] text-sm"
          style={{
            left: pos.left,
            top: pos.top,
            width: 220,
            boxShadow: 'var(--shadow-2)',
            zIndex: 2000,
          }}
        >
          <div className="px-3 py-2 border-b border-border mb-1">
            <p className="text-[11px] uppercase tracking-wide text-text-dim">Signed in as</p>
            <p className="text-[12.5px] text-text truncate" title={userEmail}>{userEmail}</p>
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={close}
            className="px-3 py-[7px] rounded-md text-[12.5px] text-text-muted hover:bg-bg-soft hover:text-text"
          >
            Account & settings
          </Link>
          <Link
            href="/settings?tab=organization"
            role="menuitem"
            onClick={close}
            className="px-3 py-[7px] rounded-md text-[12.5px] text-text-muted hover:bg-bg-soft hover:text-text"
          >
            Manage organization
          </Link>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="px-3 py-[7px] rounded-md text-left text-[12.5px] text-text-muted hover:bg-bg-soft hover:text-text"
          >
            Sign out
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
