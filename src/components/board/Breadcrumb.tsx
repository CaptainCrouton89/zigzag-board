'use client';

import { Card } from '@/lib/board/types';
import { getNodeByPath } from '@/lib/board/state';

interface Props {
  root: Card;
  path: string[];
  onNavigate: (pathIdx: number) => void;
}

function nodeTitle(n: Card): string {
  if (n.id === 'root') return 'Northlight';
  if (!n.title) return 'Untitled';
  return n.title;
}

export function Breadcrumb({ root, path, onNavigate }: Props) {
  return (
    <nav className="flex items-center gap-2 flex-wrap text-sm">
      {path.map((id, i) => {
        const n = getNodeByPath(root, path.slice(0, i + 1));
        const isCurrent = i === path.length - 1;
        const isDoing = n.status === 'doing';
        return (
          <span key={id} className="flex items-center gap-2">
            {i > 0 && (
              <span className="text-text-dim text-xs select-none">/</span>
            )}
            <span
              onClick={!isCurrent ? () => onNavigate(i) : undefined}
              className={[
                'px-2 py-[3px] rounded-md font-medium transition-colors',
                isCurrent
                  ? `font-semibold tracking-tight cursor-default ${isDoing ? 'bg-accent-soft text-accent' : 'text-text'}`
                  : `cursor-pointer text-text-muted hover:bg-bg-soft hover:text-text ${isDoing ? 'text-accent' : ''}`,
              ].join(' ')}
            >
              {nodeTitle(n)}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
