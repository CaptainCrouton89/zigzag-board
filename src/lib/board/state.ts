// Tree traversal + sort-mode helpers consumed by Board/Breadcrumb/Sidebar render path.
import { Card, SortMode } from './types';

export function getNodeByPath(root: Card, path: string[]): Card {
  let n = root;
  for (let i = 1; i < path.length; i++) {
    const found = n.cards.find(c => c.id === path[i]);
    if (!found) return root;
    n = found;
  }
  return n;
}

export function cycleSortMode(current: SortMode | undefined): SortMode {
  if (current === 'manual') return 'newest';
  if (current === 'newest') return 'oldest';
  return 'manual';
}
