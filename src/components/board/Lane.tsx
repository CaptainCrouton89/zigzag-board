'use client';

import { useRef } from 'react';
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
  onAddLane?: () => void;
  isLast?: boolean;
  laneCount: number;
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
  onAddLane,
  isLast,
  laneCount,
}: Props) {
  const archivedCount = archived.filter(a => a.laneId === lane.id).length;
  const left = laneIdx * (LANE_WIDTH + GAP);
  const archivePillRef = useRef<HTMLDivElement | null>(null);

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
              onBlur={e => {
                const v = e.currentTarget.textContent?.trim();
                onSetTitle(v && v.length > 0 ? v : 'Untitled');
              }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
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
        </div>

        {/* Stance */}
        <div
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={e => {
            const v = e.currentTarget.textContent?.trim();
            onSetStance(v !== undefined ? v : '');
          }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          data-placeholder="+ stance"
          className={[
            'text-[11px] italic px-1 cursor-text outline-none rounded leading-[1.35] hover:bg-bg-soft focus:bg-bg-soft focus:text-text',
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
