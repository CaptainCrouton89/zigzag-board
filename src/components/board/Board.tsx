'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Card as CardType, AppState, SortMode } from '@/lib/board/types';
import { getNodeByPath, cycleSortMode } from '@/lib/board/state';
import { Card } from './Card';
import { Lane } from './Lane';
import { ZigzagPath } from './ZigzagPath';
import { LANE_WIDTH, GAP, HEADER_H, RANK_STEP, COMPACT_STEP } from '@/lib/board/layout';

interface DragState {
  cardId: string;
  offX: number;
  offY: number;
  clientX: number;
  clientY: number;
}

interface Props {
  appState: AppState;
  onAddCard: (laneId: string, rank: number, title: string) => void;
  onMoveCard: (cardId: string, newLaneId: string, newRank: number) => void;
  onNestCard: (cardId: string, targetCardId: string) => void;
  onUnnestCard: (cardId: string, toPathIdx: number) => void;
  onSetStatus: (cardId: string) => void;
  onRevertStatus: (cardId: string) => void;
  onSetCardTitle: (cardId: string, title: string) => void;
  onDeleteCard: (cardId: string) => void;
  onAddLane: () => void;
  onDeleteLane: (laneId: string) => 'ok' | 'not_found' | 'non_empty';
  onToggleLaneType: (laneId: string) => void;
  onSetLaneTitle: (laneId: string, title: string) => void;
  onSetLaneStance: (laneId: string, stance: string) => void;
  onSetLaneSort: (laneId: string, sort: SortMode) => void;
  onRestoreArchived: (id: string) => void;
  onSetOpenArchive: (laneId: string | null) => void;
  onZoomIn: (cardId: string) => void;
}

interface NewCardInput {
  laneId: string;
  rank: number;
}

// Pure helpers replacing the deleted getSagaCards/getBacklogCards imports.
// All data comes from snapshot (already sorted saga-first by buildSnapshot).
function getSagaCards(node: CardType): CardType[] {
  const sagaIds = new Set(node.lanes.filter(l => l.type === 'saga').map(l => l.id));
  return node.cards.filter(c => sagaIds.has(c.laneId));
}

function getBacklogCards(node: CardType, laneId: string): CardType[] {
  const lane = node.lanes.find(l => l.id === laneId);
  if (!lane) return [];
  const cards = node.cards.filter(c => c.laneId === laneId);
  if (lane.sort === 'newest') return [...cards].sort((a, b) => b.createdAt - a.createdAt);
  if (lane.sort === 'oldest') return [...cards].sort((a, b) => a.createdAt - b.createdAt);
  return cards;
}

type DropTarget =
  | { kind: 'reorder'; laneId: string; rank: number }
  | { kind: 'nest'; targetCardId: string }
  | { kind: 'unnest'; toPathIdx: number };

// Inner band of a card's body that counts as a nest target. Outside this band
// (top/bottom edges, left/right slivers) falls through to the reorder grid so
// the existing between-rank drop behavior still works.
const NEST_BAND = 0.6;

function computeDropTarget(
  clientX: number,
  clientY: number,
  boardEl: HTMLDivElement,
  node: CardType,
  draggedCardId: string,
  sagaCardIds: Set<string>,
): { target: DropTarget; overCard: boolean } {
  // 1. Unnest first: did the cursor land on the floating "Move out" bar?
  const el = typeof document !== 'undefined'
    ? document.elementFromPoint(clientX, clientY) as HTMLElement | null
    : null;
  if (el) {
    const unnestPill = el.closest<HTMLElement>('[data-unnest-idx]');
    if (unnestPill) {
      const idx = Number(unnestPill.dataset.unnestIdx);
      if (Number.isFinite(idx)) return { target: { kind: 'unnest', toPathIdx: idx }, overCard: false };
    }
  }

  // 2. Nest: cursor in the inner band of a non-dragged saga card. The dragged
  // card has `pointer-events: none` while dragging so elementFromPoint sees
  // the card BELOW it. `overCard` is reported so the eager-reorder loop in
  // onMove can suppress reorder commits while the cursor sits over another
  // card body (in or out of the nest band) — preventing the cards-under-cursor
  // race that would otherwise shift the layout out from under the gesture.
  const cardEl = el?.closest<HTMLElement>('[data-id]') ?? null;
  const hoverId = cardEl?.dataset.id;
  const overCard = !!cardEl && hoverId !== draggedCardId && !!hoverId;
  if (cardEl && hoverId && hoverId !== draggedCardId && sagaCardIds.has(hoverId)) {
    const r = cardEl.getBoundingClientRect();
    const padX = r.width * (1 - NEST_BAND) / 2;
    const padY = r.height * (1 - NEST_BAND) / 2;
    const inBand =
      clientX >= r.left + padX && clientX <= r.right - padX &&
      clientY >= r.top + padY && clientY <= r.bottom - padY;
    if (inBand) return { target: { kind: 'nest', targetCardId: hoverId }, overCard };
  }

  // 3. Reorder: existing lane/rank grid math.
  const boardRect = boardEl.getBoundingClientRect();
  const x = clientX - boardRect.left;
  const y = clientY - boardRect.top - HEADER_H;
  const i = Math.max(0, Math.min(node.lanes.length - 1, Math.floor(x / (LANE_WIDTH + GAP))));
  const targetLane = node.lanes[i];
  if (!targetLane) return { target: { kind: 'reorder', laneId: '', rank: 0 }, overCard };
  const targetLaneId = targetLane.id;
  let filteredLen: number;
  let step: number;
  if (targetLane.type === 'saga') {
    filteredLen = getSagaCards(node).length;
    step = RANK_STEP;
  } else {
    filteredLen = node.cards.filter(c => c.laneId === targetLaneId).length;
    step = COMPACT_STEP;
  }
  const rank = Math.max(0, Math.min(filteredLen, Math.floor(y / step)));
  return { target: { kind: 'reorder', laneId: targetLaneId, rank }, overCard };
}

export function Board({
  appState,
  onAddCard,
  onMoveCard,
  onNestCard,
  onUnnestCard,
  onSetStatus,
  onRevertStatus,
  onSetCardTitle,
  onDeleteCard,
  onAddLane,
  onDeleteLane,
  onToggleLaneType,
  onSetLaneTitle,
  onSetLaneStance,
  onSetLaneSort,
  onRestoreArchived,
  onSetOpenArchive,
  onZoomIn,
}: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [newCard, setNewCard] = useState<NewCardInput | null>(null);
  const newCardInputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // R-FE-9: ensureLanes call deleted — Phase-4 server seed is the authoritative source.
  const node = getNodeByPath(appState.root, appState.path);

  const sagaCards = getSagaCards(node);
  const sagaCardIds = useMemo(() => new Set(sagaCards.map(c => c.id)), [sagaCards]);

  const handlePointerDown = useCallback((e: React.PointerEvent, cardId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const board = boardRef.current;
    if (!board) return;
    const cardEl = board.querySelector<HTMLElement>(`[data-id="${cardId}"]`);
    if (!cardEl) return;

    cardEl.style.transition = 'none';
    const rect = cardEl.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;

    const initial: DragState = { cardId, offX, offY, clientX: e.clientX, clientY: e.clientY };
    dragRef.current = initial;
    setDrag(initial);

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onWindowBlur);
      dragRef.current = null;
      setDrag(null);
      setDropTarget(null);
    };

    const onMove = (me: PointerEvent) => {
      if (me.buttons === 0) {
        cleanup();
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const b = boardRef.current;
      if (!b) return;
      const next: DragState = { ...d, clientX: me.clientX, clientY: me.clientY };
      dragRef.current = next;
      setDrag(next);

      const { target } = computeDropTarget(me.clientX, me.clientY, b, node, d.cardId, sagaCardIds);
      setDropTarget(target);
      // No eager mid-drag mutations: the dragged card already follows the
      // cursor via `position: fixed`, which is enough visual feedback. Firing
      // reorder mutations mid-drag would shift the other cards (and their
      // nest bands) out from under the cursor, making the nest gesture race
      // with the reorder gesture. All commits happen on pointerup.
    };

    const onUp = (ue: PointerEvent) => {
      const d = dragRef.current;
      const b = boardRef.current;
      if (!b || !d) {
        cleanup();
        return;
      }
      const { target } = computeDropTarget(ue.clientX, ue.clientY, b, node, d.cardId, sagaCardIds);
      if (target.kind === 'nest') {
        cleanup();
        onNestCard(cardId, target.targetCardId);
        return;
      }
      if (target.kind === 'unnest') {
        cleanup();
        onUnnestCard(cardId, target.toPathIdx);
        return;
      }
      // Reorder branch: stamp the final drop coordinates onto the card's DOM
      // so its drop animation can use the actual pointerup position as the FROM.
      // The cursor often moves a few px between the last pointermove and pointerup;
      // without this, the FLIP animates from a stale position and visibly
      // overshoots in one direction.
      const cardEl = b.querySelector<HTMLElement>(`[data-id="${cardId}"]`);
      if (cardEl) {
        cardEl.dataset.dropX = String(ue.clientX - d.offX);
        cardEl.dataset.dropY = String(ue.clientY - d.offY);
      }
      cleanup();
      onMoveCard(cardId, target.laneId, target.rank);
    };

    const onWindowBlur = () => cleanup();

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onWindowBlur);
  }, [node, sagaCardIds, onMoveCard, onNestCard, onUnnestCard]);

  // Defensive: if the page becomes hidden mid-drag, clear the drag state.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && dragRef.current) {
        dragRef.current = null;
        setDrag(null);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  function handleSagaLaneClick(e: React.MouseEvent, laneId: string) {
    const board = boardRef.current;
    if (!board) return;
    const lane = node.lanes.find(l => l.id === laneId);
    if (!lane) return;
    const boardRect = board.getBoundingClientRect();
    const y = e.clientY - boardRect.top - HEADER_H;
    const filteredLen = getSagaCards(node).length;
    const rank = Math.min(Math.max(0, Math.floor(y / RANK_STEP)), filteredLen);
    setNewCard({ laneId, rank });
    setTimeout(() => newCardInputRef.current?.focus(), 0);
  }

  function handleBacklogAdd(laneId: string) {
    const filteredLen = node.cards.filter(c => c.laneId === laneId).length;
    setNewCard({ laneId, rank: filteredLen }); // append to end
    setTimeout(() => newCardInputRef.current?.focus(), 0);
  }

  function commitNewCard() {
    const val = newCardInputRef.current?.value.trim();
    setNewCard(null);
    if (val && newCard) {
      onAddCard(newCard.laneId, newCard.rank, val);
    }
  }

  // Enter-to-chain: commit current value and open a fresh input one slot below.
  // Empty value (just Enter) closes the input like a normal commit would.
  function commitAndChainNewCard() {
    const cur = newCard;
    const input = newCardInputRef.current;
    const val = input?.value.trim();
    if (!val || !cur) {
      setNewCard(null);
      return;
    }
    onAddCard(cur.laneId, cur.rank, val);
    if (input) input.value = '';
    setNewCard({ laneId: cur.laneId, rank: cur.rank + 1 });
    setTimeout(() => newCardInputRef.current?.focus(), 0);
  }

  function cancelNewCard() {
    setNewCard(null);
  }

  function handleCreateBelow(cardId: string) {
    const card = node.cards.find(c => c.id === cardId);
    if (!card) return;
    const lane = node.lanes.find(l => l.id === card.laneId);
    if (!lane) return;
    // Rank space matches addCard's: global saga order for saga lanes, per-lane
    // order-field index for backlog. node.cards is pre-sorted by order in the
    // snapshot, so filter-then-index gives the correct insertion rank.
    let rank: number;
    if (lane.type === 'saga') {
      const sagas = node.cards.filter(c => sagaCardIds.has(c.id));
      const idx = sagas.findIndex(c => c.id === cardId);
      if (idx < 0) return;
      rank = idx + 1;
    } else {
      const backlog = node.cards.filter(c => c.laneId === card.laneId);
      const idx = backlog.findIndex(c => c.id === cardId);
      if (idx < 0) return;
      rank = idx + 1;
    }
    setNewCard({ laneId: card.laneId, rank });
    setTimeout(() => newCardInputRef.current?.focus(), 0);
  }

  // Board dimensions — based on saga rank count; backlog lanes flow naturally.
  const sagaH = Math.max(sagaCards.length, 6) * RANK_STEP;
  const backlogRowsMax = node.lanes.reduce((max, lane) => {
    if (lane.type !== 'backlog') return max;
    return Math.max(max, getBacklogCards(node, lane.id).length);
  }, 0);
  const backlogH = backlogRowsMax * COMPACT_STEP + 24;
  const bodyH = Math.max(sagaH, backlogH, 6 * RANK_STEP);
  const boardH = HEADER_H + bodyH + 24;
  // M5: zero-lane initial render before WS sync would otherwise produce boardW = -GAP = -18.
  const boardW = Math.max(0, node.lanes.length * (LANE_WIDTH + GAP) - GAP);

  if (node.lanes.length === 0) {
    return (
      <div
        className="relative flex flex-col items-center justify-center gap-3"
        style={{ minWidth: LANE_WIDTH + 48, minHeight: 6 * RANK_STEP }}
        ref={boardRef}
      >
        <p className="text-[12px] text-text-dim italic">No lanes yet</p>
        <button
          onClick={onAddLane}
          className="px-4 py-2 rounded-lg border border-dashed border-border-strong text-text-dim text-[13px] hover:text-accent hover:border-accent hover:bg-surface transition-all bg-transparent cursor-pointer"
        >
          + Add lane
        </button>
      </div>
    );
  }

  // "Move out" floating bar: visible only when zoomed in (path has at least
  // one ancestor) AND a drag is active. Each pill targets an ancestor in the
  // current path; drop on it to unnest the dragged card up to that level.
  const unnestVisible = drag !== null && appState.path.length > 1;

  return (
    <div className="relative" style={{ width: boardW, height: boardH }} ref={boardRef}>
      {unnestVisible && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 px-3 py-2 bg-bg/95 backdrop-blur-sm border border-border rounded-full shadow-[var(--shadow-2)]"
        >
          <span className="text-[10px] uppercase tracking-wide text-text-dim font-semibold pr-1">
            Move out to
          </span>
          {appState.path.slice(0, -1).map((id, i) => {
            const ancestor = getNodeByPath(appState.root, appState.path.slice(0, i + 1));
            let label: string;
            if (id === 'root') label = '↑ Board';
            else if (ancestor.title && ancestor.title.trim()) label = ancestor.title;
            else label = 'Untitled';
            const isHover = dropTarget?.kind === 'unnest' && dropTarget.toPathIdx === i;
            return (
              <span
                key={id}
                data-unnest-idx={i}
                title={label}
                className={[
                  'px-3 py-[5px] rounded-full text-[12px] font-medium transition-colors max-w-[200px] truncate',
                  isHover
                    ? 'bg-accent text-white border border-accent shadow-[0_0_0_2px_var(--accent-glow)]'
                    : 'bg-surface text-text-muted border border-border hover:bg-bg-soft',
                ].join(' ')}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}

      {/* Lane backgrounds + headers */}
      {node.lanes.map((lane, i) => {
        const cardCount = node.cards.filter(c => c.laneId === lane.id).length;
        return (
          <Lane
            key={lane.id}
            lane={lane}
            laneIdx={i}
            archived={node.archived}
            isArchiveOpen={appState.openArchive === lane.id}
            onToggleType={() => onToggleLaneType(lane.id)}
            onSetTitle={title => onSetLaneTitle(lane.id, title)}
            onSetStance={stance => onSetLaneStance(lane.id, stance)}
            onCycleSort={() => onSetLaneSort(lane.id, cycleSortMode(lane.sort))}
            onToggleArchive={() => onSetOpenArchive(appState.openArchive === lane.id ? null : lane.id)}
            onRestoreArchived={onRestoreArchived}
            onDelete={() => onDeleteLane(lane.id)}
            onAddLane={onAddLane}
            isLast={i === node.lanes.length - 1}
            laneCount={node.lanes.length}
            cardCount={cardCount}
          />
        );
      })}

      {/* Saga lane click-zones (for adding cards by clicking empty space at a y position) */}
      {node.lanes.map((lane, i) =>
        lane.type === 'saga' ? (
          <div
            key={`zone-${lane.id}`}
            className="absolute cursor-text"
            style={{
              width: LANE_WIDTH,
              left: i * (LANE_WIDTH + GAP),
              top: HEADER_H,
              height: bodyH,
              zIndex: 0,
            }}
            onClick={e => handleSagaLaneClick(e, lane.id)}
          />
        ) : null,
      )}

      {/* Zigzag SVG (under cards) */}
      <ZigzagPath sagaCards={sagaCards} lanes={node.lanes} boardRef={boardRef} />

      {/* Saga cards (absolute at board level, ranked) */}
      {sagaCards.map((card, rankIdx) => {
        const isDragging = drag?.cardId === card.id;
        const isNestTarget =
          dropTarget?.kind === 'nest' && dropTarget.targetCardId === card.id;
        return (
          <Card
            key={card.id}
            card={card}
            isSaga={true}
            laneIdx={node.lanes.findIndex(l => l.id === card.laneId)}
            rankIdx={rankIdx}
            isDragging={isDragging}
            isNestTarget={isNestTarget}
            drag={isDragging ? drag : undefined}
            onHandlePointerDown={handlePointerDown}
            onZoomIn={onZoomIn}
            onSetStatus={onSetStatus}
            onRevertStatus={onRevertStatus}
            onSetTitle={onSetCardTitle}
            onDelete={onDeleteCard}
            onCreateBelow={handleCreateBelow}
          />
        );
      })}

      {/* Backlog lanes — each is a flex column container holding its cards in flow */}
      {node.lanes.map((lane, laneIdx) => {
        if (lane.type !== 'backlog') return null;
        const items = getBacklogCards(node, lane.id);
        return (
          <div
            key={`backlog-body-${lane.id}`}
            className="absolute flex flex-col gap-[6px] px-[2px] pb-[40px] cursor-text"
            style={{
              width: LANE_WIDTH,
              left: laneIdx * (LANE_WIDTH + GAP),
              top: HEADER_H,
              minHeight: bodyH - HEADER_H + HEADER_H,
              zIndex: 1,
            }}
            onClick={e => {
              if (e.target === e.currentTarget) handleBacklogAdd(lane.id);
            }}
          >
            {items.map((card, rankIdx) => {
              const isDragging = drag?.cardId === card.id;
              return (
                <Card
                  key={card.id}
                  card={card}
                  isSaga={false}
                  laneIdx={laneIdx}
                  rankIdx={rankIdx}
                  isDragging={isDragging}
                  drag={isDragging ? drag : undefined}
                  onHandlePointerDown={handlePointerDown}
                  onZoomIn={() => {}}
                  onSetStatus={onSetStatus}
                  onRevertStatus={onRevertStatus}
                  onSetTitle={onSetCardTitle}
                  onDelete={onDeleteCard}
                  onCreateBelow={handleCreateBelow}
                />
              );
            })}
            {items.length === 0 && (
              <div className="text-[11px] italic text-text-dim text-center pt-3 pointer-events-none">
                Click to capture…
              </div>
            )}
          </div>
        );
      })}

      {/* New card input */}
      {newCard && (() => {
        const lane = node.lanes.find(l => l.id === newCard.laneId);
        const laneIdx = lane ? node.lanes.indexOf(lane) : 0;
        const isSaga = lane?.type === 'saga';
        const top = isSaga
          ? HEADER_H + newCard.rank * RANK_STEP
          : HEADER_H + newCard.rank * COMPACT_STEP;
        return (
          <textarea
            ref={newCardInputRef}
            placeholder={isSaga ? 'New checkpoint…' : 'Capture…'}
            className="absolute z-[4] bg-surface border-[1.5px] border-accent outline-none font-[inherit] text-text resize-none"
            style={{
              width: LANE_WIDTH,
              left: laneIdx * (LANE_WIDTH + GAP),
              top,
              height: isSaga ? 80 : 36,
              borderRadius: isSaga ? 10 : 7,
              padding: isSaga ? '12px 14px' : '8px 12px',
              fontSize: isSaga ? 13.5 : 12.5,
              fontWeight: isSaga ? 500 : 400,
              boxShadow: 'var(--shadow-2)',
            }}
            onBlur={commitNewCard}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitAndChainNewCard(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelNewCard(); }
            }}
          />
        );
      })()}
    </div>
  );
}
