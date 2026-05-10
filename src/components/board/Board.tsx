'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
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
  onSetStatus: (cardId: string) => void;
  onRevertStatus: (cardId: string) => void;
  onSetCardTitle: (cardId: string, title: string) => void;
  onAddLane: () => void;
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

function computeDropTarget(
  clientX: number,
  clientY: number,
  boardEl: HTMLDivElement,
  node: CardType,
): { laneId: string; rank: number } {
  const boardRect = boardEl.getBoundingClientRect();
  const x = clientX - boardRect.left;
  const y = clientY - boardRect.top - HEADER_H;
  const i = Math.max(0, Math.min(node.lanes.length - 1, Math.floor(x / (LANE_WIDTH + GAP))));
  const targetLane = node.lanes[i];
  if (!targetLane) return { laneId: '', rank: 0 };
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
  return { laneId: targetLaneId, rank };
}

export function Board({
  appState,
  onAddCard,
  onMoveCard,
  onSetStatus,
  onRevertStatus,
  onSetCardTitle,
  onAddLane,
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
  const [newCard, setNewCard] = useState<NewCardInput | null>(null);
  const newCardInputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // R-FE-9: ensureLanes call deleted — Phase-4 server seed is the authoritative source.
  const node = getNodeByPath(appState.root, appState.path);

  const sagaCards = getSagaCards(node);

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

    // Track the last (laneId, rank) sent to onMoveCard to avoid issuing
    // duplicate Y.Doc transactions: the final pointermove and the immediately-
    // following pointerup almost always resolve to the same drop target,
    // which would otherwise trigger two transacts → two snapshot rebuilds →
    // two peer broadcasts per drop.
    let lastLaneId: string | null = null;
    let lastRank = -1;

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onWindowBlur);
      dragRef.current = null;
      setDrag(null);
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

      const target = computeDropTarget(me.clientX, me.clientY, b, node);
      if (target.laneId !== lastLaneId || target.rank !== lastRank) {
        lastLaneId = target.laneId;
        lastRank = target.rank;
        onMoveCard(d.cardId, target.laneId, target.rank);
      }
    };

    const onUp = (ue: PointerEvent) => {
      // Stamp the final drop coordinates onto the card's DOM so its drop animation
      // can use the actual pointerup position as the FROM. The cursor often moves a
      // few px between the last pointermove and pointerup; without this, the FLIP
      // animates from a stale position and visibly overshoots in one direction.
      const d = dragRef.current;
      const b = boardRef.current;
      if (d && b) {
        const cardEl = b.querySelector<HTMLElement>(`[data-id="${cardId}"]`);
        if (cardEl) {
          cardEl.dataset.dropX = String(ue.clientX - d.offX);
          cardEl.dataset.dropY = String(ue.clientY - d.offY);
        }
      }
      cleanup();
      if (b) {
        const target = computeDropTarget(ue.clientX, ue.clientY, b, node);
        if (target.laneId !== lastLaneId || target.rank !== lastRank) {
          onMoveCard(cardId, target.laneId, target.rank);
        }
      }
    };

    const onWindowBlur = () => cleanup();

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onWindowBlur);
  }, [node, onMoveCard]);

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

  function cancelNewCard() {
    setNewCard(null);
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

  return (
    <div className="relative" style={{ width: boardW, height: boardH }} ref={boardRef}>
      {/* Lane backgrounds + headers */}
      {node.lanes.map((lane, i) => (
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
          onAddLane={onAddLane}
          isLast={i === node.lanes.length - 1}
          laneCount={node.lanes.length}
        />
      ))}

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
        return (
          <Card
            key={card.id}
            card={card}
            isSaga={true}
            laneIdx={node.lanes.findIndex(l => l.id === card.laneId)}
            rankIdx={rankIdx}
            isDragging={isDragging}
            drag={isDragging ? drag : undefined}
            onHandlePointerDown={handlePointerDown}
            onZoomIn={onZoomIn}
            onSetStatus={onSetStatus}
            onRevertStatus={onRevertStatus}
            onSetTitle={onSetCardTitle}
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
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNewCard(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelNewCard(); }
            }}
          />
        );
      })()}
    </div>
  );
}
