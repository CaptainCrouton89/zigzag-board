'use client'

// R-FE-4: snapshot rebuild perf — full tree walk on every Y update. Acceptable
// for v1 board sizes (~30 cards). Microtask batching is the future opt.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as Y from 'yjs'
import { getProvider } from './sync'
import { buildSnapshot } from './snapshot'
import * as mutations from './mutations'
import type { AppState, BoardCallbacks, SortMode } from './types'

// Sentinel AppState for the brief moment between mount and the first
// Y.Doc snapshot. Empty root, no lanes — Board MUST render a no-op shell
// (zero-lane safe: `boardW` is clamped via Math.max(0,…) at the call site).
// `buildSnapshot` does NOT synthesize a fallback lane — Phase-4 server seed
// is the authoritative source of `lane-default`. Synthesizing a client-only
// laneId would mint a phantom id not in the Y.Doc; any subsequent mutation
// against it would silently miss (R-FE-9, gotcha 6).
const EMPTY_APPSTATE: AppState = {
  root: {
    id: 'root', title: '', status: 'todo', laneId: '', order: '',
    createdAt: 0, lanes: [], cards: [], principles: [], archived: [],
  },
  path: ['root'],
  openArchive: null,
}

export function useBoard(orgId: string): { appState: AppState; callbacks: BoardCallbacks } {
  // 1. Provider lifecycle (refcount-bound; see sync.ts sub-plan).
  //    The provider factory caches { ydoc, provider } per orgId and
  //    increments a refcount; release() decrements and tears down on
  //    last release. React 19 strict-mode double-mount is benign because
  //    refcount goes 0 -> 1 -> 0 -> 1 across the dev double-invoke and
  //    the destroy is debounced inside sync.ts.

  // ydocRef — used only in callbacks and effects (never during render).
  const ydocRef = useRef<Y.Doc | null>(null)
  // ydocForRender — stored in state so useMemo can safely read it during render.
  const [ydocForRender, setYdocForRender] = useState<Y.Doc | null>(null)

  // 2. UI-local React state (NOT in Y.Doc).
  const [path, setPath] = useState<string[]>(['root'])
  const [openArchive, setOpenArchive] = useState<string | null>(null)
  // pathRef tracks `path` so Y.update listeners (which capture closure-time path)
  // can read the latest path without re-subscribing on every path change.
  const pathRef = useRef(path)
  useEffect(() => { pathRef.current = path }, [path])

  // 3. The Y.Doc snapshot — bumped on each Y update. Stored as a monotonic
  //    counter so React notices changes (the actual snapshot is rebuilt in
  //    the useMemo below from ydoc + path + openArchive).
  const [ydocVersion, setYdocVersion] = useState(0)

  // 4. Mount / unmount provider for this orgId.
  useEffect(() => {
    if (!orgId) return
    const { ydoc, release } = getProvider(orgId)
    ydocRef.current = ydoc

    const bumpVersion = () => setYdocVersion(v => v + 1)
    ydoc.on('update', bumpVersion)

    // Initial snapshot rebuild: defer via queueMicrotask so this effect body
    // does not call setState synchronously (avoids react-hooks/set-state-in-effect).
    // Also updates ydocForRender so useMemo can access ydoc without reading ref.
    queueMicrotask(() => {
      setYdocForRender(ydoc)
      setYdocVersion(v => v + 1)
    })

    return () => {
      ydoc.off('update', bumpVersion)
      release()              // per-call closure; idempotent + microtask-deferred
      ydocRef.current = null
      setYdocForRender(null)
    }
  }, [orgId])

  // 5. Compute appState. Rebuilt whenever ydoc emits an update OR path/openArchive change.
  //    Reads `ydocForRender` (state) instead of `ydocRef.current` (ref) to comply
  //    with react-hooks/refs — refs must not be read during render.
  const appState = useMemo<AppState>(() => {
    if (!ydocForRender) return { ...EMPTY_APPSTATE, path, openArchive }
    return buildSnapshot(ydocForRender, path, openArchive)
  }, [ydocVersion, ydocForRender, path, openArchive]) // eslint-disable-line react-hooks/exhaustive-deps

  // 6. Memoized callbacks. Bind to ydoc + pathRef.current at call time
  //    (not at memoization time) so they don't re-create on every path change.
  const onAddCard = useCallback<BoardCallbacks['onAddCard']>((laneId, rank, title) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.addCard(ydoc, pathRef.current, laneId, rank, title)
  }, [])

  const onMoveCard = useCallback<BoardCallbacks['onMoveCard']>((cardId, newLaneId, newRank) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.moveCard(ydoc, pathRef.current, cardId, newLaneId, newRank)
  }, [])

  const onNestCard = useCallback<BoardCallbacks['onNestCard']>((cardId, targetCardId) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.nestCard(ydoc, pathRef.current, cardId, targetCardId)
  }, [])

  const onUnnestCard = useCallback<BoardCallbacks['onUnnestCard']>((cardId, toPathIdx) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.unnestCard(ydoc, pathRef.current, cardId, toPathIdx)
  }, [])

  // M1 reducer-contract carryover: `setStatus` doing→done archives the card.
  // The reducer (state.ts:161) sets `cloned.openArchive = null` whenever a
  // card is archived. The Yjs mutation can't touch React-local `openArchive`
  // (UI-local), so the hook's wrapper does it after the Y write. Without this,
  // archiving a card while the lane's archive popover is open leaves the
  // popover open against a now-empty target — cosmetic regression.
  const onSetStatus = useCallback<BoardCallbacks['onSetStatus']>((cardId) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.setStatus(ydoc, pathRef.current, cardId)
    setOpenArchive(null)
  }, [])

  const onRevertStatus = useCallback<BoardCallbacks['onRevertStatus']>((cardId) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.revertStatus(ydoc, pathRef.current, cardId)
  }, [])

  const onSetCardTitle = useCallback<BoardCallbacks['onSetCardTitle']>((cardId, title) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.setCardTitle(ydoc, pathRef.current, cardId, title)
  }, [])

  const onDeleteCard = useCallback<BoardCallbacks['onDeleteCard']>((cardId) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.deleteCard(ydoc, pathRef.current, cardId)
    // Mirror onSetStatus: if the lane's archive popover was open against this
    // card's lane, the popover state can survive a deletion safely (popover
    // filters by laneId, not cardId) so no setOpenArchive(null) needed here.
  }, [])

  const onAddLane = useCallback<BoardCallbacks['onAddLane']>(() => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.addLane(ydoc, pathRef.current)
  }, [])

  const onDeleteLane = useCallback<BoardCallbacks['onDeleteLane']>((laneId) => {
    const ydoc = ydocRef.current; if (!ydoc) return 'not_found'
    const result = mutations.deleteLane(ydoc, pathRef.current, laneId)
    if (result === 'ok') setOpenArchive(null)
    return result
  }, [])

  const onToggleLaneType = useCallback<BoardCallbacks['onToggleLaneType']>((laneId) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.toggleLaneType(ydoc, pathRef.current, laneId)
  }, [])

  const onSetLaneTitle = useCallback<BoardCallbacks['onSetLaneTitle']>((laneId, title) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.setLaneTitle(ydoc, pathRef.current, laneId, title)
  }, [])

  const onSetLaneStance = useCallback<BoardCallbacks['onSetLaneStance']>((laneId, stance) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.setLaneStance(ydoc, pathRef.current, laneId, stance)
  }, [])

  const onSetLaneSort = useCallback<BoardCallbacks['onSetLaneSort']>((laneId, sort: SortMode) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.setLaneSort(ydoc, pathRef.current, laneId, sort)
  }, [])

  const onAddPrinciple = useCallback<BoardCallbacks['onAddPrinciple']>((text) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.addPrinciple(ydoc, pathRef.current, text)
  }, [])

  const onSetPrinciple = useCallback<BoardCallbacks['onSetPrinciple']>((idx, value) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.setPrinciple(ydoc, pathRef.current, idx, value)
  }, [])

  const onRemovePrinciple = useCallback<BoardCallbacks['onRemovePrinciple']>((idx) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.removePrinciple(ydoc, pathRef.current, idx)
  }, [])

  const onRestoreArchived = useCallback<BoardCallbacks['onRestoreArchived']>((archivedId) => {
    const ydoc = ydocRef.current; if (!ydoc) return
    mutations.restoreArchived(ydoc, pathRef.current, archivedId)
  }, [])

  // UI-local callbacks:
  const onSetOpenArchive = useCallback<BoardCallbacks['onSetOpenArchive']>((laneId) => {
    setOpenArchive(laneId)
  }, [])

  const onZoomIn = useCallback<BoardCallbacks['onZoomIn']>((cardId) => {
    setPath(p => [...p, cardId])
    setOpenArchive(null)
  }, [])

  const onZoomTo = useCallback<BoardCallbacks['onZoomTo']>((pathIdx) => {
    setPath(p => p.slice(0, pathIdx + 1))
    setOpenArchive(null)
  }, [])

  const onSetPath = useCallback<BoardCallbacks['onSetPath']>((newPath) => {
    setPath(newPath.length > 0 ? newPath : ['root'])
    setOpenArchive(null)
  }, [])

  const callbacks = useMemo<BoardCallbacks>(() => ({
    onAddCard, onMoveCard, onNestCard, onUnnestCard, onSetStatus, onRevertStatus, onSetCardTitle, onDeleteCard,
    onAddLane, onDeleteLane, onToggleLaneType, onSetLaneTitle, onSetLaneStance, onSetLaneSort,
    onAddPrinciple, onSetPrinciple, onRemovePrinciple, onRestoreArchived,
    onSetOpenArchive, onZoomIn, onZoomTo, onSetPath,
  }), [
    onAddCard, onMoveCard, onNestCard, onUnnestCard, onSetStatus, onRevertStatus, onSetCardTitle, onDeleteCard,
    onAddLane, onDeleteLane, onToggleLaneType, onSetLaneTitle, onSetLaneStance, onSetLaneSort,
    onAddPrinciple, onSetPrinciple, onRemovePrinciple, onRestoreArchived,
    onSetOpenArchive, onZoomIn, onZoomTo, onSetPath,
  ])

  return { appState, callbacks }
}
