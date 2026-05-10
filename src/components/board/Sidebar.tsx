'use client';

import { useRef } from 'react';
import { Card } from '@/lib/board/types';
import { getNodeByPath } from '@/lib/board/state';

interface Props {
  root: Card;
  path: string[];
  onAddPrinciple: (text: string) => void;
  onSetPrinciple: (idx: number, value: string) => void;
  onRemovePrinciple: (idx: number) => void;
}

function nodeTitle(n: Card): string {
  if (n.id === 'root') return 'Northlight';
  if (!n.title) return 'Untitled';
  return n.title;
}

export function Sidebar({ root, path, onAddPrinciple, onSetPrinciple, onRemovePrinciple }: Props) {
  const addRef = useRef<HTMLDivElement>(null);

  const cur = getNodeByPath(root, path);

  // Collect inherited principles and lane stances from ancestors
  const inherited: { text: string; source: string }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const ancestor = getNodeByPath(root, path.slice(0, i + 1));
    const title = nodeTitle(ancestor);
    ancestor.principles.forEach(p => {
      inherited.push({ text: p, source: title });
    });
    // Also include lane stances from the ancestor's lanes
    ancestor.lanes.forEach(lane => {
      if (lane.stance) {
        inherited.push({ text: `[${lane.title}] ${lane.stance}`, source: title });
      }
    });
  }

  function handleAddPrinciple() {
    onAddPrinciple('New principle');
    // Focus newly added item after render
    requestAnimationFrame(() => {
      const container = addRef.current?.parentElement;
      if (!container) return;
      const items = container.querySelectorAll<HTMLDivElement>('[data-own-principle]');
      const last = items[items.length - 1];
      if (last) {
        last.focus();
        const range = document.createRange();
        range.selectNodeContents(last);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
    });
  }

  return (
    <aside
      className="w-[280px] shrink-0 border-r border-border flex flex-col overflow-y-auto"
      style={{ background: 'linear-gradient(180deg, var(--accent-soft) 0%, rgba(253,231,197,0.18) 60%, var(--bg) 100%)', borderLeft: '3px solid var(--accent)' }}
    >
      <div className="px-4 pt-4 pb-2 text-[10px] font-bold tracking-[0.1em] uppercase text-accent select-none">
        Principles
      </div>
      <div className="flex flex-col gap-1 px-3 pb-4 flex-1">
        {inherited.map((item, i) => (
          <div
            key={i}
            title={`inherited from ${item.source}`}
            className="text-xs italic text-text-muted opacity-55 leading-snug px-1 py-[2px] rounded before:content-['◇'] before:text-accent before:mr-2 before:text-[9px] before:align-middle before:not-italic"
          >
            {item.text}
          </div>
        ))}

        {cur.principles.map((p, idx) => (
          <div
            key={idx}
            data-own-principle="1"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            className="text-[13px] italic text-text leading-snug px-1 py-[2px] rounded outline-none before:content-['◆'] before:text-accent before:mr-2 before:text-[9px] before:align-middle before:not-italic focus:bg-white/50 focus:not-italic"
            onBlur={e => {
              const val = e.currentTarget.textContent?.trim();
              if (!val) {
                onRemovePrinciple(idx);
              } else {
                onSetPrinciple(idx, val);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            }}
          >
            {p}
          </div>
        ))}

        <div
          ref={addRef}
          onClick={handleAddPrinciple}
          className="text-[11px] text-text-dim cursor-pointer py-[2px] tracking-wide self-start hover:text-accent transition-colors"
        >
          + add principle
        </div>
      </div>
    </aside>
  );
}
