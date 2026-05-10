'use client'

import { Suspense, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Sidebar } from '@/components/board/Sidebar'
import { Breadcrumb } from '@/components/board/Breadcrumb'
import { Board } from '@/components/board/Board'
import { useBoard } from '@/lib/board/useBoard'

function HomeInner() {
  // PHASE-6: replace `?orgId=` query-param bootstrap with server-component
  // session.activeOrganizationId gate. Grep `// PHASE-6:` to find every site.
  const sp = useSearchParams()
  const orgId = sp.get('orgId') !== null ? (sp.get('orgId') as string) : ''

  // ALL hooks run unconditionally below. `useBoard('')` short-circuits its
  // provider effect (no WS subscription, no Y.Doc update listener) so the
  // empty-orgId case is benign at runtime. The `if (!orgId)` guard fires at
  // the JSX-return site, AFTER every hook has been called this render.
  const { appState, callbacks } = useBoard(orgId)
  const wrapRef = useRef<HTMLDivElement>(null)

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

  // Esc to zoom out one level — but skip while editing text
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return
      if (appState.path.length > 1) {
        animateZoom(null)
        setTimeout(() => callbacks.onZoomTo(appState.path.length - 2), 320)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [appState.path, animateZoom, callbacks])

  const handleZoomIn = useCallback((cardId: string) => {
    const cardEl = document.querySelector<HTMLElement>(`[data-id="${cardId}"]`)
    animateZoom(cardEl)
    setTimeout(() => callbacks.onZoomIn(cardId), 320)
  }, [animateZoom, callbacks])

  const handleNavigate = useCallback((pathIdx: number) => {
    if (pathIdx >= appState.path.length - 1) return
    animateZoom(null)
    setTimeout(() => callbacks.onZoomTo(pathIdx), 320)
  }, [appState.path, animateZoom, callbacks])

  // ALL hooks above. The early-return for missing orgId comes ONLY as a JSX
  // fallback at the bottom — never above a hook call.
  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-screen text-text-muted text-sm">
        No org selected. Append <code className="bg-bg-soft px-1 rounded mx-1">?orgId=&lt;orgId&gt;</code> to the URL.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="px-9 py-3 border-b border-border flex items-center justify-between gap-8 bg-bg">
        <Breadcrumb root={appState.root} path={appState.path} onNavigate={handleNavigate} />
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
      </header>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          root={appState.root}
          path={appState.path}
          onAddPrinciple={callbacks.onAddPrinciple}
          onSetPrinciple={callbacks.onSetPrinciple}
          onRemovePrinciple={callbacks.onRemovePrinciple}
        />
        <main className="flex-1 overflow-auto p-9">
          <div ref={wrapRef} className="w-max mx-auto">
            <Board
              appState={appState}
              onAddCard={callbacks.onAddCard}
              onMoveCard={callbacks.onMoveCard}
              onSetStatus={callbacks.onSetStatus}
              onRevertStatus={callbacks.onRevertStatus}
              onSetCardTitle={callbacks.onSetCardTitle}
              onAddLane={callbacks.onAddLane}
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

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  )
}
