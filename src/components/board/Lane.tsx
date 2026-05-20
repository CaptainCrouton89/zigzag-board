'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lane as LaneType, ArchivedItem } from '@/lib/board/types';
import { ArchivePopover } from './ArchivePopover';
import { LANE_WIDTH, GAP, HEADER_H } from '@/lib/board/layout';

interface Props {
  lane: LaneType;
  laneIdx: number;
  archived: ArchivedItem[];
  isArchiveOpen: boolean;
  onToggleType: () => void;
  onSetTitle: (title: string) => void;
  onSetStance: (stance: string) => void;
  onCycleSort: () => void;
  onToggleArchive: () => void;
  onRestoreArchived: (id: string) => void;
  onDelete: () => 'ok' | 'not_found' | 'non_empty';
  onAddLane?: () => void;
  isLast?: boolean;
  laneCount: number;
  cardCount: number;
}

export function Lane({
  lane,
  laneIdx,
  archived,
  isArchiveOpen,
  onToggleType,
  onSetTitle,
  onSetStance,
  onCycleSort,
  onToggleArchive,
  onRestoreArchived,
  onDelete,
  onAddLane,
  isLast,
  laneCount,
  cardCount,
}: Props) {
  const archivedCount = archived.filter(a => a.laneId === lane.id).length;
  const left = laneIdx * (LANE_WIDTH + GAP);
  const archivePillRef = useRef<HTMLDivElement | null>(null);

  // Lane menu — small portal-rendered dropdown anchored to the ⋯ trigger.
  // Mirrors OrgSwitcher's pattern (portal + outside-click + Escape) so it
  // can escape the lane's overflow-hidden ancestors.
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  // Delete is the only destructive option, so the menu doubles as the confirm
  // surface: first click on "Delete lane" arms the action (subtitle changes to
  // "Click again to confirm"); second click executes. Esc/outside disarms.
  const [armDelete, setArmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const update = () => {
      const el = menuTriggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuPos({ left: rect.right - 200, top: rect.bottom + 4 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (menuPanelRef.current?.contains(t)) return;
      if (menuTriggerRef.current?.contains(t)) return;
      setMenuOpen(false);
      setArmDelete(false);
      setDeleteError(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setArmDelete(false);
        setDeleteError(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function handleDeleteClick() {
    setDeleteError(null);
    if (!armDelete) { setArmDelete(true); return; }
    const result = onDelete();
    if (result === 'non_empty') {
      setArmDelete(false);
      setDeleteError(`Archive or move ${cardCount} card${cardCount === 1 ? '' : 's'} first`);
      return;
    }
    setArmDelete(false);
    setMenuOpen(false);
  }

  const sortLabel =
    lane.type === 'backlog'
      ? lane.sort === 'newest' ? '↓ newest' : lane.sort === 'oldest' ? '↑ oldest' : '≡ manual'
      : null;

  return (
    <>
      {/* Lane background */}
      <div
        className={`absolute top-0 h-full rounded-lg transition-colors ${lane.type === 'saga' ? 'bg-[rgba(180,83,9,0.025)]' : 'bg-[rgba(31,29,26,0.02)]'}`}
        style={{ width: LANE_WIDTH, left }}
      />

      {/* Lane header */}
      <div
        className="group absolute top-0 flex flex-col gap-1 border-b border-dashed border-border-strong px-2 pt-[6px] pb-3"
        style={{ width: LANE_WIDTH, left, height: HEADER_H }}
      >
        {/* Title row */}
        <div className="flex items-center justify-between gap-[6px]">
          <div className="flex items-center gap-[6px] flex-1 min-w-0">
            <div
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              title={lane.title}
              onBlur={e => {
                const v = e.currentTarget.textContent?.trim();
                onSetTitle(v && v.length > 0 ? v : 'Untitled');
              }}
              onKeyDown={e => {
                // Lane titles are single-line (whitespace-nowrap + ellipsis), so Shift+Enter
                // would only render as a space anyway — collapse all Enter variants to blur.
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              }}
              className="text-[12px] font-semibold tracking-[0.06em] uppercase text-text cursor-text outline-none px-1 py-[1px] rounded flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap hover:bg-bg-soft focus:bg-bg-soft"
            >
              {lane.title}
            </div>

            {lane.type === 'backlog' && (
              <button
                onClick={onCycleSort}
                className="text-[9px] font-semibold tracking-[0.08em] uppercase px-[5px] py-[2px] rounded bg-bg-soft text-text-muted border border-border hover:border-border-strong transition-colors shrink-0"
                title="Cycle sort: manual → newest → oldest"
              >
                {sortLabel}
              </button>
            )}
          </div>

          <div className="flex items-center gap-[3px] shrink-0">
            <button
              onClick={onToggleType}
              className={[
                'text-[9px] font-bold tracking-[0.10em] uppercase px-[5px] py-[2px] rounded transition-all shrink-0 cursor-pointer hover:brightness-95',
                lane.type === 'saga'
                  ? 'text-accent bg-accent-soft'
                  : 'text-text-muted bg-bg-soft border border-border',
              ].join(' ')}
              title="Click to toggle saga ↔ backlog"
            >
              {lane.type}
            </button>

            <button
              ref={menuTriggerRef}
              type="button"
              onClick={() => {
                setMenuOpen(o => !o);
                setArmDelete(false);
                setDeleteError(null);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Lane options"
              className={[
                'text-[12px] leading-none px-[4px] py-[2px] rounded transition-all shrink-0 cursor-pointer',
                menuOpen
                  ? 'text-text bg-bg-soft opacity-100'
                  : 'text-text-dim opacity-0 group-hover:opacity-100 hover:text-text hover:bg-bg-soft',
              ].join(' ')}
            >
              ⋯
            </button>
          </div>
        </div>

        {/* Stance */}
        <div
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={e => {
            // Stance can wrap to multiple lines; preserve newlines via innerText.
            const v = e.currentTarget.innerText?.trim();
            onSetStance(v !== undefined ? v : '');
          }}
          onKeyDown={e => {
            // Shift+Enter inserts newline; plain Enter blurs.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
          }}
          data-placeholder="+ stance"
          className={[
            'text-[11px] italic px-1 cursor-text outline-none rounded leading-[1.35] whitespace-pre-wrap hover:bg-bg-soft focus:bg-bg-soft focus:text-text',
            'empty:before:content-[attr(data-placeholder)] empty:before:text-text-dim empty:before:not-italic empty:before:opacity-0 group-hover:empty:before:opacity-60 focus:empty:before:opacity-60 transition-opacity',
            lane.stance ? 'text-text-muted' : 'text-transparent',
          ].join(' ')}
        >
          {lane.stance}
        </div>

        {/* Archive pill */}
        <div
          ref={archivePillRef}
          onClick={archivedCount > 0 ? onToggleArchive : undefined}
          className={[
            'self-start text-[10.5px] text-text-dim px-[7px] py-[1px] rounded-full bg-surface border border-border inline-flex items-center gap-[3px] transition-colors',
            archivedCount > 0 ? 'cursor-pointer hover:text-text hover:border-border-strong' : 'opacity-40 cursor-default',
          ].join(' ')}
        >
          <span
            className="text-[8px] inline-block transition-transform"
            style={{ transform: isArchiveOpen ? 'rotate(90deg)' : undefined }}
          >
            ▶
          </span>
          {archivedCount} done
        </div>

        {isArchiveOpen && archivedCount > 0 && (
          <ArchivePopover
            items={archived}
            laneId={lane.id}
            anchorRef={archivePillRef}
            onRestore={onRestoreArchived}
          />
        )}

        {menuOpen && menuPos && typeof document !== 'undefined' && createPortal(
          <div
            ref={menuPanelRef}
            role="menu"
            className="fixed rounded-xl border border-border bg-surface p-1 flex flex-col gap-[2px] text-sm"
            style={{
              left: menuPos.left,
              top: menuPos.top,
              width: 200,
              boxShadow: 'var(--shadow-2)',
              zIndex: 2000,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleDeleteClick}
              className={[
                'flex flex-col items-start gap-[1px] px-2 py-[7px] rounded-md text-left',
                armDelete
                  ? 'bg-bg-soft text-red-700'
                  : 'text-text-muted hover:bg-bg-soft hover:text-red-700',
              ].join(' ')}
            >
              <span className="text-[12.5px] font-medium">
                {armDelete ? 'Click again to confirm' : 'Delete lane'}
              </span>
              {armDelete && (
                <span className="text-[10.5px] text-text-muted">Esc to cancel</span>
              )}
              {!armDelete && cardCount > 0 && (
                <span className="text-[10.5px] text-text-dim">
                  {cardCount} card{cardCount === 1 ? '' : 's'} must be cleared first
                </span>
              )}
            </button>
            {deleteError && (
              <p role="alert" className="px-2 py-1 text-[11px] text-red-700">{deleteError}</p>
            )}
          </div>,
          document.body,
        )}
      </div>

      {/* Add-lane button (only on last lane) */}
      {isLast && onAddLane && (
        <button
          onClick={onAddLane}
          title="Add lane"
          className="absolute top-[6px] w-[30px] h-[30px] rounded-lg border border-dashed border-border-strong text-text-dim text-[18px] flex items-center justify-center cursor-pointer hover:text-accent hover:border-accent hover:bg-surface transition-all bg-transparent"
          style={{ left: laneCount * (LANE_WIDTH + GAP) - GAP + 14 }}
        >
          +
        </button>
      )}
    </>
  );
}
