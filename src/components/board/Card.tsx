'use client';

import { useLayoutEffect, useRef } from 'react';
import { Card as CardType } from '@/lib/board/types';
import { LANE_WIDTH, GAP, HEADER_H, RANK_STEP } from '@/lib/board/layout';

const DragHandle = () => (
  <svg width="6" height="14" viewBox="0 0 6 14" fill="currentColor">
    <circle cx="1.5" cy="2" r="1.1" />
    <circle cx="4.5" cy="2" r="1.1" />
    <circle cx="1.5" cy="7" r="1.1" />
    <circle cx="4.5" cy="7" r="1.1" />
    <circle cx="1.5" cy="12" r="1.1" />
    <circle cx="4.5" cy="12" r="1.1" />
  </svg>
);

const PlayIcon = () => (
  <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor">
    <polygon points="3,1.5 3,10.5 10.5,6" />
  </svg>
);

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2.5,6.5 5,9 9.5,3.5" />
  </svg>
);

const RevertIcon = () => (
  <svg width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 5 Q 5 1, 8 5" />
    <polyline points="2,3 2,5 4,5" />
  </svg>
);

const GridIcon = () => (
  <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor">
    <rect x="1" y="1" width="4" height="4" rx="1" />
    <rect x="7" y="1" width="4" height="4" rx="1" />
    <rect x="1" y="7" width="4" height="4" rx="1" />
    <rect x="7" y="7" width="4" height="4" rx="1" />
  </svg>
);

const REST_TRANSITION =
  'top 220ms cubic-bezier(0.2,0.7,0.2,1), left 220ms cubic-bezier(0.2,0.7,0.2,1), box-shadow 140ms, transform 140ms';

interface DragRenderState {
  clientX: number;
  clientY: number;
  offX: number;
  offY: number;
}

interface Props {
  card: CardType;
  isSaga: boolean;
  laneIdx: number;
  rankIdx: number;
  isDragging?: boolean;
  drag?: DragRenderState | null;
  onHandlePointerDown: (e: React.PointerEvent, cardId: string) => void;
  onZoomIn: (cardId: string) => void;
  onSetStatus: (cardId: string) => void;
  onRevertStatus: (cardId: string) => void;
  onSetTitle: (cardId: string, title: string) => void;
}

export function Card({
  card,
  isSaga,
  laneIdx,
  rankIdx,
  isDragging,
  drag,
  onHandlePointerDown,
  onZoomIn,
  onSetStatus,
  onRevertStatus,
  onSetTitle,
}: Props) {
  const titleRef = useRef<HTMLDivElement>(null);
  const originalTitle = useRef(card.title);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const wasDraggingRef = useRef(false);

  // FLIP-on-drop: when isDragging flips off, re-place the card at the drop spot
  // via `transform: translate(...)` and animate back to identity. Transform avoids
  // the `position: fixed → absolute` top/left coordinate-context switch.
  useLayoutEffect(() => {
    const wasDragging = wasDraggingRef.current;
    wasDraggingRef.current = !!isDragging;
    if (!wasDragging || isDragging) return;

    const el = cardRef.current;
    if (!el) return;
    const rawX = el.dataset.dropX;
    const rawY = el.dataset.dropY;
    delete el.dataset.dropX;
    delete el.dataset.dropY;
    if (!rawX || !rawY) return;
    const stampedX = parseFloat(rawX);
    const stampedY = parseFloat(rawY);
    if (!Number.isFinite(stampedX) || !Number.isFinite(stampedY)) return;

    // CRITICAL: kill the CSS transition BEFORE measuring. React just committed
    // `transition: REST_TRANSITION` (with top/left) and new top/left values.
    // The `getBoundingClientRect` below forces a style flush — if the REST rule
    // is still in effect at that flush, the browser starts a top/left transition
    // interpolating the old `position: fixed` viewport values as the new
    // `position: absolute` board-relative values, flying the card across the board.
    el.style.transition = 'none';

    const rect = el.getBoundingClientRect();
    const dx = stampedX - rect.left;
    const dy = stampedY - rect.top;
    if (dx === 0 && dy === 0) return;

    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.025) rotate(0.4deg)`;
    void el.offsetHeight;
    el.style.transition = 'transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 140ms';
    el.style.transform = '';

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      el.style.transition = REST_TRANSITION;
      el.style.transform = '';
      el.removeEventListener('transitionend', onEnd);
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.propertyName === 'transform') cleanup();
    };
    el.addEventListener('transitionend', onEnd);
    const t = window.setTimeout(cleanup, 320);
    return () => {
      window.clearTimeout(t);
      el.removeEventListener('transitionend', onEnd);
    };
  });

  // Positioning logic:
  //  - dragging: position: fixed, viewport coords
  //  - saga (not dragging): absolute at board level, computed from rank/lane
  //  - backlog (not dragging): relative, flowing inside lane-body
  const posStyle: React.CSSProperties = isDragging && drag
    ? {
        position: 'fixed',
        left: drag.clientX - drag.offX,
        top: drag.clientY - drag.offY,
        width: LANE_WIDTH,
        zIndex: 1000,
      }
    : isSaga
    ? {
        position: 'absolute',
        top: HEADER_H + rankIdx * RANK_STEP,
        left: laneIdx * (LANE_WIDTH + GAP),
        width: LANE_WIDTH,
        zIndex: 3,
      }
    : {
        position: 'relative',
        width: '100%',
        zIndex: 3,
      };

  const childCount = card.cards.length;
  const doingChildren = card.cards.filter(c => c.status === 'doing').length;

  function handleBodyClick(e: React.MouseEvent) {
    if (!isSaga) return;
    if ((e.target as HTMLElement).closest('[data-title]')) return;
    onZoomIn(card.id);
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  }

  function handleTitleBlur(e: React.FocusEvent<HTMLDivElement>) {
    const val = e.currentTarget.textContent?.trim();
    if (!val) {
      e.currentTarget.textContent = originalTitle.current;
    } else {
      originalTitle.current = val;
      onSetTitle(card.id, val);
    }
  }

  return (
    <div
      ref={cardRef}
      data-id={card.id}
      style={{
        height: isSaga ? 80 : undefined,
        minHeight: isSaga ? undefined : 36,
        borderRadius: isSaga ? 10 : 7,
        transition: isDragging ? 'none' : REST_TRANSITION,
        ...posStyle,
      }}
      className={[
        'bg-surface border flex items-stretch overflow-hidden select-none',
        card.status === 'doing'
          ? 'border-accent shadow-[0_0_0_2px_var(--accent-glow),var(--shadow-1)]'
          : 'border-border shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)]',
        isDragging ? 'scale-[1.025] rotate-[0.4deg] cursor-grabbing shadow-[var(--shadow-2)]' : '',
        isSaga ? 'cursor-zoom-in' : '',
        card.status === 'doing' ? 'doing-card' : '',
      ].join(' ')}
    >
      {/* DOING accent stripe */}
      {card.status === 'doing' && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 animate-doing-pulse pointer-events-none"
          style={{ background: 'linear-gradient(180deg, var(--accent), var(--accent-2))' }}
        />
      )}

      {/* Drag handle */}
      <div
        className="flex-none flex items-center justify-center cursor-grab active:cursor-grabbing text-text-dim hover:text-text-muted hover:bg-bg-soft transition-colors"
        style={{ width: isSaga ? 18 : 14 }}
        title="Drag to reorder"
        onPointerDown={e => {
          e.stopPropagation();
          onHandlePointerDown(e, card.id);
        }}
      >
        <DragHandle />
      </div>

      {/* Body */}
      <div
        className={[
          'flex-1 min-w-0 flex',
          isSaga ? 'flex-col justify-between py-[10px] px-2 pl-2' : 'flex-row items-center gap-[6px] py-[6px] px-[6px]',
        ].join(' ')}
        onClick={handleBodyClick}
      >
        <div
          ref={titleRef}
          data-title="1"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          className={[
            'outline-none cursor-text break-words',
            isSaga
              ? 'text-[13.5px] font-medium leading-[1.32] text-text overflow-hidden line-clamp-2'
              : 'text-[12.5px] font-normal text-text leading-[1.25] flex-1',
            card.status === 'done' ? 'line-through text-done' : '',
          ].join(' ')}
        >
          {card.title}
        </div>

        {isSaga && (
          <div className="flex items-center gap-[6px] mt-1 text-[10px] text-text-dim uppercase tracking-[0.04em]">
            {card.status === 'doing' && (
              <span className="text-accent font-semibold">● in flight</span>
            )}
            {childCount > 0 && (
              <span className="inline-flex items-center gap-[3px]">
                <GridIcon />
                {childCount}{doingChildren > 0 ? ` · ${doingChildren} live` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status button */}
      <div
        className="flex-none flex items-center justify-center bg-transparent hover:bg-bg-soft transition-colors relative cursor-pointer"
        style={{ width: isSaga ? 36 : 28 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onSetStatus(card.id); }}
      >
        <div
          className={[
            'rounded-full border-[1.5px] flex items-center justify-center transition-all',
            isSaga ? 'w-[22px] h-[22px] text-[10px]' : 'w-[16px] h-[16px] text-[8px]',
            card.status === 'doing'
              ? 'bg-accent border-accent text-white'
              : 'bg-surface border-border-strong text-text-muted hover:border-accent hover:text-accent',
          ].join(' ')}
          title={card.status === 'doing' ? 'Mark done' : 'Start working'}
        >
          {card.status === 'doing' ? <CheckIcon /> : <PlayIcon />}
        </div>

        {card.status === 'doing' && (
          <div
            className={[
              'absolute rounded-full bg-surface border border-border-strong text-text-muted',
              'items-center justify-center cursor-pointer hover:text-text hover:border-text-muted doing-revert',
              isSaga ? 'w-[14px] h-[14px] text-[9px] bottom-[6px] right-1' : 'w-[11px] h-[11px] text-[7px] bottom-[3px] right-[2px]',
            ].join(' ')}
            title="Back to todo"
            onClick={e => { e.stopPropagation(); onRevertStatus(card.id); }}
          >
            <RevertIcon />
          </div>
        )}
      </div>
    </div>
  );
}
