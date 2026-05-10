'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArchivedItem } from '@/lib/board/types';

interface Props {
  items: ArchivedItem[];
  laneIdx: number;
  anchorRef: React.RefObject<HTMLElement | null>;
  onRestore: (id: string) => void;
}

export function ArchivePopover({ items, laneIdx, anchorRef, onRestore }: Props) {
  const filtered = items.filter(a => a.lane === laneIdx);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Align to anchor's left, just below; lane width is constant.
      setPos({ left: rect.left, top: rect.bottom + 6, width: 256 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  if (filtered.length === 0 || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed rounded-xl border border-border bg-surface p-2 flex flex-col gap-1"
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        boxShadow: 'var(--shadow-2)',
        zIndex: 2000,
      }}
    >
      {filtered.map(a => (
        <div
          key={a.id}
          onClick={() => onRestore(a.id)}
          className="flex items-center justify-between gap-2 px-2 py-[6px] rounded-md cursor-pointer text-text-muted text-[12.5px] hover:bg-bg-soft hover:text-text group"
        >
          <span className="line-through flex-1 min-w-0 truncate">{a.title}</span>
          <span className="text-[10px] text-accent uppercase tracking-wide opacity-0 group-hover:opacity-100 shrink-0">
            restore
          </span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
