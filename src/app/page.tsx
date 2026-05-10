'use client';

import { useReducer, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from '@/components/board/Sidebar';
import { Breadcrumb } from '@/components/board/Breadcrumb';
import { Board } from '@/components/board/Board';
import { reducer } from '@/lib/board/state';
import { loadState, saveState } from '@/lib/board/storage';
import type { AppState } from '@/lib/board/types';

const ROOT_PLACEHOLDER: AppState = {
  root: {
    id: 'root',
    title: 'Northlight',
    status: 'todo',
    lane: 0,
    createdAt: 0,
    lanes: [],
    cards: [],
    principles: [],
    archived: [],
  },
  path: ['root'],
  openArchive: null,
};

export default function Home() {
  const [state, dispatch] = useReducer(reducer, ROOT_PLACEHOLDER);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const loaded = loadState();
    dispatch({ type: 'LOAD_STATE', state: loaded });
    hydratedRef.current = true;
  }, []);

  // Persist on change (post-hydration)
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveState(state);
  }, [state]);

  // Zoom animation: scale + crossfade. cardEl != null = zooming IN to that card.
  const animateZoom = useCallback((cardEl: HTMLElement | null) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (cardEl) {
      const rect = cardEl.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const ox = rect.left + rect.width / 2 - wrapRect.left;
      const oy = rect.top + rect.height / 2 - wrapRect.top;
      wrap.style.transformOrigin = `${ox}px ${oy}px`;
    } else {
      wrap.style.transformOrigin = '50% 50%';
    }
    wrap.style.transition = 'transform 320ms cubic-bezier(0.55, 0.05, 0.55, 1), opacity 240ms ease 60ms';
    wrap.style.transform = cardEl ? 'scale(2.6)' : 'scale(0.45)';
    wrap.style.opacity = '0';
    setTimeout(() => {
      wrap.style.transition = 'none';
      wrap.style.transform = cardEl ? 'scale(0.55)' : 'scale(1.8)';
      wrap.style.opacity = '0';
      requestAnimationFrame(() => {
        wrap.style.transition = 'transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 240ms ease';
        wrap.style.transform = 'scale(1)';
        wrap.style.opacity = '1';
        setTimeout(() => {
          wrap.style.transition = '';
          wrap.style.transform = '';
        }, 360);
      });
    }, 320);
  }, []);

  // Esc to zoom out one level — but skip while editing text
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
      if (state.path.length > 1) {
        animateZoom(null);
        setTimeout(() => dispatch({ type: 'ZOOM_TO', pathIdx: state.path.length - 2 }), 320);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.path, animateZoom]);

  const handleZoomIn = useCallback(
    (cardId: string) => {
      const cardEl = document.querySelector<HTMLElement>(`[data-id="${cardId}"]`);
      animateZoom(cardEl);
      setTimeout(() => dispatch({ type: 'ZOOM_INTO', cardId }), 320);
    },
    [animateZoom],
  );

  const handleNavigate = useCallback(
    (pathIdx: number) => {
      if (pathIdx >= state.path.length - 1) return;
      animateZoom(null);
      setTimeout(() => dispatch({ type: 'ZOOM_TO', pathIdx }), 320);
    },
    [state.path, animateZoom],
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="px-9 py-3 border-b border-border flex items-center justify-between gap-8 bg-bg">
        <Breadcrumb root={state.root} path={state.path} onNavigate={handleNavigate} />
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
          root={state.root}
          path={state.path}
          onAddPrinciple={(text) => dispatch({ type: 'ADD_PRINCIPLE', principle: text })}
          onSetPrinciple={(idx, value) => dispatch({ type: 'SET_PRINCIPLE', idx, value })}
          onRemovePrinciple={(idx) => dispatch({ type: 'REMOVE_PRINCIPLE', idx })}
        />
        <main className="flex-1 overflow-auto p-9">
          <div ref={wrapRef} className="w-max mx-auto">
            <Board
              appState={state}
              onAddCard={(laneIdx, rank, title) => dispatch({ type: 'ADD_CARD', laneIdx, rank, title })}
              onMoveCard={(cardId, newLaneIdx, newRank) => dispatch({ type: 'MOVE_CARD', cardId, newLaneIdx, newRank })}
              onSetStatus={(cardId) => dispatch({ type: 'SET_STATUS', cardId })}
              onRevertStatus={(cardId) => dispatch({ type: 'REVERT_STATUS', cardId })}
              onSetCardTitle={(cardId, title) => dispatch({ type: 'SET_CARD_TITLE', cardId, title })}
              onAddLane={() => dispatch({ type: 'ADD_LANE' })}
              onToggleLaneType={(laneIdx) => dispatch({ type: 'TOGGLE_LANE_TYPE', laneIdx })}
              onSetLaneTitle={(laneIdx, title) => dispatch({ type: 'SET_LANE_TITLE', laneIdx, title })}
              onSetLaneStance={(laneIdx, stance) => dispatch({ type: 'SET_LANE_STANCE', laneIdx, stance })}
              onSetLaneSort={(laneIdx, sort) => dispatch({ type: 'SET_LANE_SORT', laneIdx, sort })}
              onRestoreArchived={(id) => dispatch({ type: 'RESTORE_ARCHIVED', archivedId: id })}
              onSetOpenArchive={(laneIdx) => dispatch({ type: 'SET_OPEN_ARCHIVE', laneIdx })}
              onZoomIn={handleZoomIn}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
