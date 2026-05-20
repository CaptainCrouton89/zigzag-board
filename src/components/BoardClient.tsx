'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/board/Sidebar'
import { Breadcrumb } from '@/components/board/Breadcrumb'
import { Board } from '@/components/board/Board'
import { OrgSwitcher } from '@/components/board/OrgSwitcher'
import { useBoard } from '@/lib/board/useBoard'
import { getNodeByPath } from '@/lib/board/state'
import { authClient } from '@/lib/auth-client'

interface BoardClientProps {
  orgId: string
  userEmail: string
}

// `history.state` shape carries router metadata from Next; merge our zoomPath
// into it without clobbering anything else the router stashed.
type HistoryWithZoom = { zoomPath?: string[] } & Record<string, unknown>

function readZoomPath(): string[] | null {
  if (typeof window === 'undefined') return null
  const s = window.history.state as HistoryWithZoom | null
  const zp = s?.zoomPath
  return Array.isArray(zp) && zp.length > 0 ? zp : null
}

function writeZoomPath(zoomPath: string[], mode: 'push' | 'replace') {
  if (typeof window === 'undefined') return
  const prev = (window.history.state as HistoryWithZoom | null) ?? {}
  const next = { ...prev, zoomPath }
  if (mode === 'push') window.history.pushState(next, '')
  else window.history.replaceState(next, '')
}

function samePath(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export default function BoardClient({ orgId, userEmail }: BoardClientProps) {
  const router = useRouter()
  const { appState, callbacks } = useBoard(orgId)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgName = activeOrg ? activeOrg.name : 'Board'
  const isZoomed = appState.path.length > 1
  const currentNode = isZoomed ? getNodeByPath(appState.root, appState.path) : null
  const currentTitle = currentNode && currentNode.title ? currentNode.title : 'Untitled'

  // Mirror appState.path so popstate / esc / breadcrumb handlers can read the
  // current depth without re-binding on every zoom.
  const pathRef = useRef(appState.path)
  useEffect(() => { pathRef.current = appState.path }, [appState.path])

  // Zoom animation: scale + crossfade. cardEl != null = zooming IN to that card.
  const animateZoom = useCallback((cardEl: HTMLElement | null) => {
    const wrap = wrapRef.current
    if (!wrap) return
    if (cardEl) {
      const rect = cardEl.getBoundingClientRect()
      const wrapRect = wrap.getBoundingClientRect()
      const ox = rect.left + rect.width / 2 - wrapRect.left
      const oy = rect.top + rect.height / 2 - wrapRect.top
      wrap.style.transformOrigin = `${ox}px ${oy}px`
    } else {
      wrap.style.transformOrigin = '50% 50%'
    }
    wrap.style.transition = 'transform 320ms cubic-bezier(0.55, 0.05, 0.55, 1), opacity 240ms ease 60ms'
    wrap.style.transform = cardEl ? 'scale(2.6)' : 'scale(0.45)'
    wrap.style.opacity = '0'
    setTimeout(() => {
      wrap.style.transition = 'none'
      wrap.style.transform = cardEl ? 'scale(0.55)' : 'scale(1.8)'
      wrap.style.opacity = '0'
      requestAnimationFrame(() => {
        wrap.style.transition = 'transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 240ms ease'
        wrap.style.transform = 'scale(1)'
        wrap.style.opacity = '1'
        setTimeout(() => {
          wrap.style.transition = ''
          wrap.style.transform = ''
        }, 360)
      })
    }, 320)
  }, [])

  // Seed history state on mount so the current entry carries the initial
  // zoomPath. If the entry already has one (e.g., user came back to this page
  // via Next router and the entry was preserved), restore it into appState.
  useEffect(() => {
    const existing = readZoomPath()
    if (existing) {
      if (!samePath(existing, pathRef.current)) {
        callbacks.onSetPath(existing)
      }
    } else {
      writeZoomPath(pathRef.current, 'replace')
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Browser back/forward → drive zoom from history.state. Esc and breadcrumb
  // clicks both delegate to history.go(...), so they also flow through here.
  useEffect(() => {
    const onPop = () => {
      const next = readZoomPath() ?? ['root']
      const cur = pathRef.current
      if (samePath(next, cur)) return
      const goingDeeper = next.length > cur.length
      if (goingDeeper) {
        const targetId = next[next.length - 1]
        const cardEl = document.querySelector<HTMLElement>(`[data-id="${targetId}"]`)
        animateZoom(cardEl)
      } else {
        animateZoom(null)
      }
      setTimeout(() => callbacks.onSetPath(next), 320)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [animateZoom, callbacks])

  // Esc to zoom out one level — but skip while editing text
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return
      if (pathRef.current.length > 1) {
        window.history.back()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleZoomIn = useCallback((cardId: string) => {
    const cardEl = document.querySelector<HTMLElement>(`[data-id="${cardId}"]`)
    animateZoom(cardEl)
    const newPath = [...pathRef.current, cardId]
    writeZoomPath(newPath, 'push')
    setTimeout(() => callbacks.onZoomIn(cardId), 320)
  }, [animateZoom, callbacks])

  const handleNavigate = useCallback((pathIdx: number) => {
    const cur = pathRef.current
    if (pathIdx >= cur.length - 1) return
    const delta = pathIdx - (cur.length - 1) // negative
    window.history.go(delta) // popstate listener handles animation + setPath
  }, [])

  // R-RG-3: signOut → push order is critical. Server clears the cookie inside
  // signOut(); only after that does the next nav see a missing cookie. If we
  // raced these in parallel, router.push('/login') would re-fetch the gate
  // before the cookie was cleared, briefly redirecting BACK to '/'.
  const handleSignOut = useCallback(async () => {
    await authClient.signOut()
    router.push('/login')
  }, [router])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="px-9 py-3 border-b border-border flex items-center justify-between gap-8 bg-bg">
        <Breadcrumb root={appState.root} path={appState.path} orgName={orgName} onNavigate={handleNavigate} />
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-[6px]">
              <span className="inline-block w-[22px] h-[2px] rounded bg-accent" />
              priority weave (sagas only)
            </span>
            <span className="inline-flex items-center gap-[6px]">
              <kbd className="font-[inherit] text-[10.5px] px-[5px] py-[1px] rounded bg-bg-soft border border-border text-text">esc</kbd>
              zoom out
            </span>
            <span>click card → zoom in</span>
          </div>
          <OrgSwitcher activeOrgId={orgId} activeOrgName={orgName} />
          {/* M-1: min-w-0 lets the truncating <span> shrink below content width
              on narrow viewports; without it, `truncate max-w-[160px]` is
              ineffective inside a flex parent and the email pushes Sign-out
              off-screen. */}
          <div className="flex items-center gap-2 pl-4 border-l border-border min-w-0">
            <span
              className="text-[11px] text-text-muted truncate max-w-[160px]"
              title={userEmail}
            >
              {userEmail}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-[11px] text-text-muted hover:text-text underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          root={appState.root}
          path={appState.path}
          orgName={orgName}
          onAddPrinciple={callbacks.onAddPrinciple}
          onSetPrinciple={callbacks.onSetPrinciple}
          onRemovePrinciple={callbacks.onRemovePrinciple}
        />
        <main className="flex-1 overflow-auto p-9">
          {isZoomed && (
            <div className="max-w-[920px] mx-auto mb-6">
              <h1 className="text-[15px] leading-[1.45] text-text-muted whitespace-pre-wrap">
                {currentTitle}
              </h1>
            </div>
          )}
          <div ref={wrapRef} className="w-max mx-auto">
            <Board
              appState={appState}
              onAddCard={callbacks.onAddCard}
              onMoveCard={callbacks.onMoveCard}
              onNestCard={callbacks.onNestCard}
              onUnnestCard={callbacks.onUnnestCard}
              onSetStatus={callbacks.onSetStatus}
              onRevertStatus={callbacks.onRevertStatus}
              onSetCardTitle={callbacks.onSetCardTitle}
              onDeleteCard={callbacks.onDeleteCard}
              onAddLane={callbacks.onAddLane}
              onDeleteLane={callbacks.onDeleteLane}
              onToggleLaneType={callbacks.onToggleLaneType}
              onSetLaneTitle={callbacks.onSetLaneTitle}
              onSetLaneStance={callbacks.onSetLaneStance}
              onSetLaneSort={callbacks.onSetLaneSort}
              onRestoreArchived={callbacks.onRestoreArchived}
              onSetOpenArchive={callbacks.onSetOpenArchive}
              onZoomIn={handleZoomIn}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
