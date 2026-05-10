import { AppState, Card } from './types';
import { createSeedData } from './seed';
import { normalizeLanesOrder, syncNextIdFromTree } from './state';

const STORAGE_KEY = 'zigzagboard-v1';

function normalizeAll(node: Card): void {
  normalizeLanesOrder(node);
  node.cards.forEach(normalizeAll);
}

function freshSeed(): AppState {
  const root = createSeedData();
  syncNextIdFromTree(root);
  return { root, path: ['root'], openArchive: null };
}

export function loadState(): AppState {
  if (typeof window === 'undefined') return freshSeed();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return freshSeed();
  const parsed = JSON.parse(raw) as AppState;
  // Defensively normalize so persisted data also honors backlog-rightmost.
  normalizeAll(parsed.root);
  // Bump the runtime id counter past anything already in the persisted tree
  // so new cards/lanes don't collide with existing ids on next render.
  syncNextIdFromTree(parsed.root);
  return { ...parsed, openArchive: null };
}

export function saveState(state: AppState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
