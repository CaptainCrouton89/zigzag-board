'use client'

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  // Eager-validation policy — matches auth-client.ts / onboarding/page.tsx.
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

type Tab = 'account' | 'organization'

// Explicit error-message extraction. better-auth errors may have an empty/
// undefined `message`, so we check for a non-empty string before using it
// and otherwise return the caller-supplied fallback. Centralized here so
// every call site uses the same predicate.
function errorText(err: { message?: string | null } | null | undefined, fallback: string): string {
  if (err && typeof err.message === 'string' && err.message.length > 0) return err.message
  return fallback
}

// Choose the most identifying label we have for a member row: name first, then
// email, then the raw userId as a last resort. Avoids `||` fallbacks for the
// hook's lint policy and centralizes the precedence.
function memberDisplayName(m: MemberRow): string {
  const user = m.user
  if (user) {
    if (typeof user.name === 'string' && user.name.length > 0) return user.name
    if (typeof user.email === 'string' && user.email.length > 0) return user.email
  }
  return m.userId
}

export default function SettingsPage() {
  // useSearchParams() in SettingsInner triggers Next's CSR-bailout error at
  // build time unless the consumer is rendered under a Suspense boundary
  // (Next.js: "missing-suspense-with-csr-bailout"). Mirrors the same wrap
  // in (auth)/login and (auth)/signup.
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <SettingsInner />
    </Suspense>
  )
}

function SettingsInner() {
  const router = useRouter()
  const params = useSearchParams()
  const tabParam = params.get('tab')
  const initialTab: Tab = tabParam === 'organization' ? 'organization' : 'account'
  const [tab, setTab] = useState<Tab>(initialTab)

  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()

  // Gate: unauthenticated users go to /login with a return path.
  useEffect(() => {
    if (sessionPending) return
    if (!session) router.replace('/login?next=/settings')
  }, [session, sessionPending, router])

  if (sessionPending || !session) {
    return <div className="min-h-screen bg-bg" />
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Header — slim bar with back link + identity chip */}
      <header className="px-9 py-3 border-b border-border flex items-center justify-between gap-8 bg-bg">
        <Link
          href="/"
          className="text-[12.5px] text-text-muted hover:text-text inline-flex items-center gap-[6px]"
        >
          <span aria-hidden>←</span> Back to board
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-text-muted truncate max-w-[200px]" title={session.user.email}>
            {session.user.email}
          </span>
        </div>
      </header>

      <div className="flex-1 flex justify-center overflow-auto">
        <div className="w-full max-w-[920px] px-9 py-10 flex gap-9">
          {/* Left rail tabs */}
          <nav className="w-[160px] shrink-0 flex flex-col gap-[2px] text-[13px]">
            <TabLink active={tab === 'account'} onClick={() => setTab('account')}>
              Account
            </TabLink>
            <TabLink active={tab === 'organization'} onClick={() => setTab('organization')}>
              Organization
            </TabLink>
          </nav>

          {/* Right panel */}
          <main className="flex-1 min-w-0 flex flex-col gap-6">
            {tab === 'account' && <AccountPanel />}
            {tab === 'organization' && (
              activeOrg
                ? <OrganizationPanel orgId={activeOrg.id} orgName={activeOrg.name} userId={session.user.id} />
                : <NoOrgState />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function TabLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'text-left px-3 py-[7px] rounded-md transition-colors',
        active
          ? 'bg-bg-soft text-text font-medium'
          : 'text-text-muted hover:bg-bg-soft hover:text-text',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-[14px] font-semibold text-text mb-1">{title}</h2>
      {description && <p className="text-[12.5px] text-text-muted mb-4">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  )
}

function NoOrgState() {
  return (
    <Section title="Organization">
      <p className="text-[13px] text-text-muted">
        No active organization. <Link href="/onboarding" className="text-accent hover:underline">Create or join one</Link>.
      </p>
    </Section>
  )
}

// ============ ACCOUNT PANEL ============

function AccountPanel() {
  const { data: session, refetch } = authClient.useSession()
  const router = useRouter()
  const user = session?.user

  // AccountPanel only renders after the parent has waited on useSession, so
  // user.name is available at mount and the lazy initializer captures it.
  // We don't sync user.name back into local state mid-edit — onSaveName's
  // refetch() updates the session but the input keeps the user's draft.
  const initialName = typeof user?.name === 'string' ? user.name : ''
  const [name, setName] = useState(initialName)
  const [namePending, setNamePending] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwPending, setPwPending] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const [deletePw, setDeletePw] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)

  async function onSaveName(e: FormEvent) {
    e.preventDefault()
    if (namePending) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameMsg({ kind: 'err', text: 'Name cannot be empty' })
      return
    }
    setNamePending(true)
    setNameMsg(null)
    const { error } = await authClient.updateUser({ name: trimmed })
    setNamePending(false)
    if (error) {
      setNameMsg({ kind: 'err', text: errorText(error, 'Could not update name') })
      return
    }
    setNameMsg({ kind: 'ok', text: 'Saved' })
    refetch()
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault()
    if (pwPending) return
    setPwMsg(null)
    if (newPw.length < 8) {
      setPwMsg({ kind: 'err', text: 'New password must be at least 8 characters' })
      return
    }
    setPwPending(true)
    const { error } = await authClient.changePassword({
      currentPassword: currentPw,
      newPassword: newPw,
      revokeOtherSessions: true,
    })
    setPwPending(false)
    if (error) {
      setPwMsg({ kind: 'err', text: errorText(error, 'Could not change password') })
      return
    }
    setCurrentPw('')
    setNewPw('')
    setPwMsg({ kind: 'ok', text: 'Password changed. Other sessions signed out.' })
  }

  async function onSignOut() {
    await authClient.signOut()
    router.push('/login')
  }

  async function onDeleteAccount(e: FormEvent) {
    e.preventDefault()
    if (deletePending) return
    setDeleteError(null)
    if (!deletePw) {
      setDeleteError('Enter your current password')
      return
    }
    setDeletePending(true)
    const { error } = await authClient.deleteUser({ password: deletePw })
    setDeletePending(false)
    if (error) {
      setDeleteError(errorText(error, 'Could not delete account'))
      return
    }
    // On success better-auth signs out and revokes the session; route home so
    // the root gate sends us to /login.
    router.push('/login')
  }

  return (
    <>
      <Section title="Profile" description="Visible to other members of your organizations.">
        <form onSubmit={onSaveName} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-text-muted">
            Email
            <input
              type="text"
              readOnly
              value={typeof user?.email === 'string' ? user.email : ''}
              className="px-3 py-2 rounded border border-border bg-bg-soft text-text-muted text-sm font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-muted">
            Display name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={namePending}
              className="px-3 py-2 rounded border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={namePending || name.trim() === (typeof user?.name === 'string' ? user.name : '')}
              className="px-3 py-2 rounded bg-accent text-white text-[13px] font-medium disabled:opacity-50"
            >
              {namePending ? 'Saving…' : 'Save name'}
            </button>
            {nameMsg && (
              <span className={`text-[12px] ${nameMsg.kind === 'ok' ? 'text-text-muted' : 'text-red-700'}`}>
                {nameMsg.text}
              </span>
            )}
          </div>
        </form>
      </Section>

      <Section title="Password" description="Changing your password signs you out everywhere else.">
        <form onSubmit={onChangePassword} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-text-muted">
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              disabled={pwPending}
              className="px-3 py-2 rounded border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-muted">
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              disabled={pwPending}
              className="px-3 py-2 rounded border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pwPending || !currentPw || !newPw}
              className="px-3 py-2 rounded bg-accent text-white text-[13px] font-medium disabled:opacity-50"
            >
              {pwPending ? 'Changing…' : 'Change password'}
            </button>
            {pwMsg && (
              <span className={`text-[12px] ${pwMsg.kind === 'ok' ? 'text-text-muted' : 'text-red-700'}`}>
                {pwMsg.text}
              </span>
            )}
          </div>
        </form>
      </Section>

      <Section title="Session">
        <button
          type="button"
          onClick={onSignOut}
          className="px-3 py-2 rounded border border-border bg-bg text-text-muted text-[13px] hover:text-text hover:bg-bg-soft"
        >
          Sign out of this browser
        </button>
      </Section>

      <Section title="Delete account" description="Permanent. Your name and email are removed; organizations you own remain unless you also delete them.">
        {!deleteArmed ? (
          <button
            type="button"
            onClick={() => setDeleteArmed(true)}
            className="px-3 py-2 rounded border border-red-700 text-red-700 text-[13px] hover:bg-red-50"
          >
            Delete my account
          </button>
        ) : (
          <form onSubmit={onDeleteAccount} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-text-muted">
              Confirm with your current password
              <input
                type="password"
                autoComplete="current-password"
                value={deletePw}
                onChange={(e) => setDeletePw(e.target.value)}
                disabled={deletePending}
                autoFocus
                className="px-3 py-2 rounded border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={deletePending}
                className="px-3 py-2 rounded bg-red-700 text-white text-[13px] font-medium disabled:opacity-60"
              >
                {deletePending ? 'Deleting…' : 'Permanently delete account'}
              </button>
              <button
                type="button"
                onClick={() => { setDeleteArmed(false); setDeletePw(''); setDeleteError(null) }}
                disabled={deletePending}
                className="px-3 py-2 rounded border border-border bg-bg text-text-muted text-[13px] hover:text-text"
              >
                Cancel
              </button>
            </div>
            {deleteError && <p role="alert" className="text-[12px] text-red-700">{deleteError}</p>}
          </form>
        )}
      </Section>
    </>
  )
}

// ============ ORGANIZATION PANEL ============

interface MemberRow {
  id: string
  role: string
  userId: string
  user?: { id: string; email: string; name?: string | null }
}

function OrganizationPanel({ orgId, orgName, userId }: { orgId: string; orgName: string; userId: string }) {
  const router = useRouter()
  const [members, setMembers] = useState<MemberRow[] | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)
  const myMembership = members ? members.find(m => m.userId === userId) : undefined
  const myRole: string | null = myMembership ? myMembership.role : null
  const isOwner = myRole === 'owner'

  // Explicit reload after a mutation (remove member). Mount-time fetch
  // happens in the effect below — that one is the IIFE pattern to satisfy
  // react-hooks/set-state-in-effect.
  const reloadMembers = useCallback(async () => {
    setMembersError(null)
    const { data, error } = await authClient.organization.listMembers({
      query: { organizationId: orgId },
    })
    if (error) {
      setMembersError(errorText(error, 'Could not load members'))
      setMembers([])
      return
    }
    // better-auth response shape is { members: MemberRow[], total: number }.
    const body = data as unknown as { members?: MemberRow[] } | null
    const list = body && Array.isArray(body.members) ? body.members : []
    setMembers(list)
  }, [orgId])

  // Mount-time fetch via inline async IIFE — same pattern as OrgSwitcher.tsx.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await authClient.organization.listMembers({
        query: { organizationId: orgId },
      })
      if (cancelled) return
      if (error) {
        setMembersError(errorText(error, 'Could not load members'))
        setMembers([])
        return
      }
      const body = data as unknown as { members?: MemberRow[] } | null
      const list = body && Array.isArray(body.members) ? body.members : []
      setMembers(list)
    })()
    return () => { cancelled = true }
  }, [orgId])

  // Org name editing — initial value from prop at mount; later changes (e.g.
  // from another tab) aren't synced into the input mid-edit on purpose.
  const [nameInput, setNameInput] = useState(orgName)
  const [namePending, setNamePending] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function onRenameOrg(e: FormEvent) {
    e.preventDefault()
    if (namePending) return
    setNameMsg(null)
    const trimmed = nameInput.trim()
    if (!trimmed) {
      setNameMsg({ kind: 'err', text: 'Name cannot be empty' })
      return
    }
    setNamePending(true)
    const { error } = await authClient.organization.update({
      data: { name: trimmed },
      organizationId: orgId,
    })
    setNamePending(false)
    if (error) {
      setNameMsg({ kind: 'err', text: errorText(error, 'Could not rename') })
      return
    }
    setNameMsg({ kind: 'ok', text: 'Saved' })
    // Force a reload so OrgSwitcher + Sidebar pick up the new name from the
    // useActiveOrganization hook without further plumbing.
    setTimeout(() => router.refresh(), 400)
  }

  // Member removal
  const [removingId, setRemovingId] = useState<string | null>(null)
  async function onRemoveMember(memberId: string) {
    if (removingId) return
    setRemovingId(memberId)
    const { error } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId: orgId,
    })
    setRemovingId(null)
    if (error) {
      setMembersError(errorText(error, 'Could not remove member'))
      return
    }
    reloadMembers()
  }

  // Leave org
  const [leavePending, setLeavePending] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  async function onLeaveOrg() {
    if (leavePending) return
    setLeaveError(null)
    setLeavePending(true)
    const { error } = await authClient.organization.leave({ organizationId: orgId })
    setLeavePending(false)
    if (error) {
      setLeaveError(errorText(error, 'Could not leave organization'))
      return
    }
    // Server-side org state changed — hard reload so the root gate re-evaluates
    // (matches OrgSwitcher's reloadToBoard pattern).
    window.location.assign('/')
  }

  // Delete org (owner-only). better-auth's organization/delete cascades to
  // board + orgInviteCode via FK onDelete:'cascade' and nulls the session's
  // activeOrganizationId. After deletion we pick any remaining membership
  // and set it active so the user lands on a board instead of /onboarding;
  // if there are none, the root gate routes to /onboarding on reload.
  const [deleteOrgArmed, setDeleteOrgArmed] = useState(false)
  const [deleteOrgPending, setDeleteOrgPending] = useState(false)
  const [deleteOrgError, setDeleteOrgError] = useState<string | null>(null)

  async function onDeleteOrg() {
    if (deleteOrgPending) return
    setDeleteOrgError(null)
    setDeleteOrgPending(true)
    const { error } = await authClient.organization.delete({ organizationId: orgId })
    if (error) {
      setDeleteOrgPending(false)
      setDeleteOrgError(errorText(error, 'Could not delete organization'))
      return
    }
    // Best-effort switch into a remaining org. Failures here are non-fatal:
    // the root gate handles a null activeOrganizationId by sending the user
    // through onboarding, which is the safe fallback.
    try {
      const res = await fetch(`${API_URL}/api/org/me`, { credentials: 'include' })
      if (res.ok) {
        const body = (await res.json()) as { orgs?: Array<{ id: string }> }
        const next = Array.isArray(body.orgs) ? body.orgs[0] : undefined
        if (next) {
          await fetch(`${API_URL}/api/org/${encodeURIComponent(next.id)}/select`, {
            method: 'POST',
            credentials: 'include',
          })
        }
      }
    } catch {
      // fall through to reload
    }
    window.location.assign('/')
  }

  // Invite link
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [regenArmed, setRegenArmed] = useState(false)

  // Mount-time invite fetch (owner-only). All setState calls live inside the
  // awaited continuations of an async IIFE — never synchronous in the effect
  // body — to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!isOwner) return
    let cancelled = false
    ;(async () => {
      setInviteLoading(true)
      setInviteError(null)
      try {
        const res = await fetch(`${API_URL}/api/org/${encodeURIComponent(orgId)}/invite`, {
          credentials: 'include',
        })
        if (cancelled) return
        if (!res.ok) {
          setInviteError(res.status === 403 ? 'Only owners can view the invite link' : 'Could not load invite link')
          return
        }
        const body = (await res.json()) as { inviteUrl?: string }
        if (cancelled) return
        if (!body.inviteUrl) {
          setInviteError('Server returned an unexpected response')
          return
        }
        setInviteUrl(body.inviteUrl)
      } catch {
        if (!cancelled) setInviteError('Network error')
      } finally {
        if (!cancelled) setInviteLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isOwner, orgId])

  async function onCopyInvite() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 1500)
    } catch {
      const el = document.getElementById('org-invite-input') as HTMLInputElement | null
      el?.select()
    }
  }

  async function onRegenerateInvite() {
    if (!regenArmed) { setRegenArmed(true); return }
    setRegenArmed(false)
    setInviteLoading(true)
    setInviteError(null)
    try {
      const res = await fetch(`${API_URL}/api/org/${encodeURIComponent(orgId)}/invite/regenerate`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        setInviteError('Could not regenerate invite link')
        return
      }
      const body = (await res.json()) as { inviteUrl?: string }
      if (body.inviteUrl) setInviteUrl(body.inviteUrl)
    } catch {
      setInviteError('Network error')
    } finally {
      setInviteLoading(false)
    }
  }

  return (
    <>
      <Section title="Organization name">
        <form onSubmit={onRenameOrg} className="flex flex-col gap-3">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            disabled={namePending || !isOwner}
            className="px-3 py-2 rounded border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent disabled:bg-bg-soft disabled:text-text-muted"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={namePending || !isOwner || nameInput.trim() === orgName}
              className="px-3 py-2 rounded bg-accent text-white text-[13px] font-medium disabled:opacity-50"
            >
              {namePending ? 'Saving…' : 'Save'}
            </button>
            {!isOwner && <span className="text-[12px] text-text-dim">Owners only</span>}
            {nameMsg && (
              <span className={`text-[12px] ${nameMsg.kind === 'ok' ? 'text-text-muted' : 'text-red-700'}`}>
                {nameMsg.text}
              </span>
            )}
          </div>
        </form>
      </Section>

      <Section title="Members" description={members ? `${members.length} member${members.length === 1 ? '' : 's'}` : undefined}>
        {members === null && !membersError && (
          <p className="text-[12.5px] text-text-muted">Loading…</p>
        )}
        {membersError && (
          <p role="alert" className="text-[12.5px] text-red-700 mb-2">{membersError}</p>
        )}
        {members && members.length > 0 && (
          <ul className="flex flex-col">
            {members.map((m, i) => {
              const isSelf = m.userId === userId
              const canRemove = isOwner && !isSelf && m.role !== 'owner'
              return (
                <li
                  key={m.id}
                  className={[
                    'flex items-center justify-between gap-3 py-[10px]',
                    i > 0 ? 'border-t border-border' : '',
                  ].join(' ')}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] text-text truncate">
                      {memberDisplayName(m)}
                      {isSelf && <span className="text-text-dim text-[11px] ml-2">you</span>}
                    </span>
                    {m.user && typeof m.user.name === 'string' && m.user.name.length > 0 && typeof m.user.email === 'string' && (
                      <span className="text-[11.5px] text-text-muted truncate">{m.user.email}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] uppercase tracking-wide text-text-dim">{m.role}</span>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => onRemoveMember(m.id)}
                        disabled={removingId === m.id}
                        className="text-[11.5px] text-text-muted hover:text-red-700 disabled:opacity-50"
                      >
                        {removingId === m.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {isOwner && (
        <Section title="Invite link" description="Anyone with this link can join as a member. Regenerate to invalidate old links.">
          {inviteError && <p role="alert" className="text-[12.5px] text-red-700 mb-2">{inviteError}</p>}
          {inviteUrl ? (
            <div className="flex flex-col gap-3">
              <input
                id="org-invite-input"
                type="text"
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="px-3 py-2 rounded border border-border bg-bg-soft text-text text-sm font-mono"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCopyInvite}
                  className="px-3 py-2 rounded border border-border bg-bg text-text text-[13px] hover:bg-bg-soft"
                >
                  {inviteCopied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={onRegenerateInvite}
                  disabled={inviteLoading}
                  className={[
                    'px-3 py-2 rounded text-[13px] border transition-colors',
                    regenArmed
                      ? 'border-red-700 text-red-700 bg-bg hover:bg-red-50'
                      : 'border-border bg-bg text-text-muted hover:text-text hover:bg-bg-soft',
                  ].join(' ')}
                  title={regenArmed ? 'Click again to confirm' : 'Old links will stop working'}
                >
                  {inviteLoading ? 'Working…' : regenArmed ? 'Click again to confirm' : 'Regenerate'}
                </button>
                {regenArmed && (
                  <button
                    type="button"
                    onClick={() => setRegenArmed(false)}
                    className="text-[12px] text-text-muted hover:text-text"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : !inviteError ? (
            <p className="text-[12.5px] text-text-muted">Loading…</p>
          ) : null}
        </Section>
      )}

      {!isOwner && myRole !== null && (
        <Section title="Leave organization" description="You'll lose access to this board immediately.">
          <button
            type="button"
            onClick={onLeaveOrg}
            disabled={leavePending}
            className="px-3 py-2 rounded border border-red-700 text-red-700 text-[13px] hover:bg-red-50 disabled:opacity-60"
          >
            {leavePending ? 'Leaving…' : 'Leave organization'}
          </button>
          {leaveError && <p role="alert" className="text-[12px] text-red-700 mt-2">{leaveError}</p>}
        </Section>
      )}

      {isOwner && (
        <Section title="Delete organization" description="Permanently deletes the organization, its board, and removes all members. This cannot be undone.">
          {!deleteOrgArmed ? (
            <button
              type="button"
              onClick={() => setDeleteOrgArmed(true)}
              className="px-3 py-2 rounded border border-red-700 text-red-700 text-[13px] hover:bg-red-50"
            >
              Delete organization
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[12.5px] text-text-muted">
                This will permanently delete <span className="font-medium text-text">{orgName}</span> and remove all member access.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onDeleteOrg}
                  disabled={deleteOrgPending}
                  className="px-3 py-2 rounded bg-red-700 text-white text-[13px] font-medium disabled:opacity-60"
                >
                  {deleteOrgPending ? 'Deleting…' : 'Permanently delete organization'}
                </button>
                <button
                  type="button"
                  onClick={() => { setDeleteOrgArmed(false); setDeleteOrgError(null) }}
                  disabled={deleteOrgPending}
                  className="px-3 py-2 rounded border border-border bg-bg text-text-muted text-[13px] hover:text-text"
                >
                  Cancel
                </button>
              </div>
              {deleteOrgError && <p role="alert" className="text-[12px] text-red-700">{deleteOrgError}</p>}
            </div>
          )}
        </Section>
      )}
    </>
  )
}
