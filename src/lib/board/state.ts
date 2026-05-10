// Phase 5 transitional: this reducer is no longer reachable from page.tsx.
// It stays in tree as the canonical mutation spec for comparison during
// verification. Phase 7 deletes. Adapted to compile against the post-T2 types.
import { AppState, Action, Card, Lane, SortMode } from './types';

let nextId = 2000;
export const newId = (prefix = 'n') => `${prefix}${nextId++}`;

// Walk the tree, find the largest trailing numeric suffix on any id (cards, lanes,
// archived nodes), and bump `nextId` past it. Call after loading persisted state or
// after seeding so freshly-minted ids can never collide with what's already there.
export function syncNextIdFromTree(root: Card): void {
  let max = 0;
  const check = (id: string) => {
    const m = /(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  };
  const visit = (n: Card) => {
    check(n.id);
    n.lanes?.forEach(l => check(l.id));
    n.cards.forEach(visit);
    n.archived?.forEach(a => visit(a.node));
  };
  visit(root);
  if (max >= nextId) nextId = max + 1;
}

export function getNodeByPath(root: Card, path: string[]): Card {
  let n = root;
  for (let i = 1; i < path.length; i++) {
    const found = n.cards.find(c => c.id === path[i]);
    if (!found) return root;
    n = found;
  }
  return n;
}

export function ensureLanes(n: Card): void {
  if (!n.lanes || n.lanes.length === 0) {
    const fallbackLane: Lane = { id: newId('l'), title: 'Next steps', type: 'saga', order: 'a0' };
    n.lanes = [fallbackLane];
  }
  n.cards.forEach(c => {
    if (!n.lanes.some(l => l.id === c.laneId)) {
      c.laneId = n.lanes[0].id;
    }
  });
}

// Reorders lanes so backlogs always come last (visual rule).
// Remaps every card's and archived item's laneId accordingly.
export function normalizeLanesOrder(n: Card): void {
  if (!n.lanes || n.lanes.length < 2) return;
  const ranked = n.lanes.map((lane, oldIdx) => ({ lane, oldIdx, isSaga: lane.type === 'saga' }));
  const sagas = ranked.filter(r => r.isSaga);
  const backlogs = ranked.filter(r => !r.isSaga);
  const newOrder = [...sagas, ...backlogs];
  // Already in order? No-op.
  if (newOrder.every((r, i) => r.oldIdx === i)) return;
  // Build id-based remap (laneId stays stable — only visual position changes).
  n.lanes = newOrder.map(r => r.lane);
  // laneId is now a string lane id (stable), not a positional index — no remap needed.
}

export function getSagaCards(node: Card): Card[] {
  const sagaIds = new Set(node.lanes.filter(l => l.type === 'saga').map(l => l.id));
  return node.cards.filter(c => sagaIds.has(c.laneId));
}

// `getBacklogCards` removed: its old `(node, laneIdx)` signature is stale
// under the laneId-keyed schema (Phase 5) and the reducer in this file does
// not call it. Board.tsx defines a local `(node, laneId)` version for its
// render path. Phase 7 deletes this whole reducer file.

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function reducer(state: AppState, action: Action): AppState {
  if (action.type === 'LOAD_STATE') return action.state;

  const cloned = deepClone(state);
  const cur = getNodeByPath(cloned.root, cloned.path);
  ensureLanes(cur);

  switch (action.type) {
    case 'ADD_CARD': {
      const { laneIdx, rank, title } = action;
      const lane = cur.lanes[laneIdx];
      if (!lane) return state;
      const newCard: Card = {
        id: newId('c'),
        title,
        status: 'todo',
        laneId: lane.id,
        order: 'a0',
        createdAt: Date.now(),
        lanes: [],
        cards: [],
        principles: [],
        archived: [],
      };
      let filtered: Card[];
      if (lane.type === 'saga') {
        filtered = getSagaCards(cur);
      } else {
        filtered = cur.cards.filter(c => c.laneId === lane.id);
      }
      let insertAt: number;
      if (rank >= filtered.length) {
        insertAt = cur.cards.length;
      } else {
        insertAt = cur.cards.indexOf(filtered[rank]);
      }
      cur.cards.splice(insertAt, 0, newCard);
      return cloned;
    }

    case 'MOVE_CARD': {
      const { cardId, newLaneIdx, newRank } = action;
      const cardIdx = cur.cards.findIndex(c => c.id === cardId);
      if (cardIdx < 0) return state;
      const [card] = cur.cards.splice(cardIdx, 1);
      const newLane = cur.lanes[newLaneIdx];
      if (!newLane) { cur.cards.splice(cardIdx, 0, card); return state; }
      card.laneId = newLane.id;
      let filtered: Card[];
      if (newLane.type === 'saga') {
        filtered = getSagaCards(cur);
      } else {
        filtered = cur.cards.filter(c => c.laneId === newLane.id);
      }
      const clamped = Math.max(0, Math.min(filtered.length, newRank));
      let insertAt: number;
      if (clamped >= filtered.length) {
        insertAt = cur.cards.length;
      } else {
        insertAt = cur.cards.indexOf(filtered[clamped]);
      }
      cur.cards.splice(insertAt, 0, card);
      return cloned;
    }

    case 'SET_STATUS': {
      const card = cur.cards.find(c => c.id === action.cardId);
      if (!card) return state;
      if (card.status === 'todo') {
        card.status = 'doing';
      } else if (card.status === 'doing') {
        card.status = 'done';
        const idx = cur.cards.indexOf(card);
        cur.cards.splice(idx, 1);
        cur.archived.push({ id: card.id, title: card.title, laneId: card.laneId, node: card });
        cloned.openArchive = null;
      }
      return cloned;
    }

    case 'REVERT_STATUS': {
      const card = cur.cards.find(c => c.id === action.cardId);
      if (!card) return state;
      card.status = 'todo';
      return cloned;
    }

    case 'SET_CARD_TITLE': {
      const card = cur.cards.find(c => c.id === action.cardId);
      if (!card) return state;
      card.title = action.title;
      return cloned;
    }

    case 'ADD_LANE': {
      cur.lanes.push({ id: newId('l'), title: 'New direction', type: 'saga', stance: '', order: 'a0' });
      normalizeLanesOrder(cur);
      return cloned;
    }

    case 'TOGGLE_LANE_TYPE': {
      const lane = cur.lanes[action.laneIdx];
      if (!lane) return state;
      lane.type = lane.type === 'saga' ? 'backlog' : 'saga';
      // Default sort for newly-backlog lanes
      if (lane.type === 'backlog' && !lane.sort) lane.sort = 'manual';
      normalizeLanesOrder(cur);
      return cloned;
    }

    case 'SET_LANE_TITLE': {
      const lane = cur.lanes[action.laneIdx];
      if (!lane) return state;
      lane.title = action.title;
      return cloned;
    }

    case 'SET_LANE_STANCE': {
      const lane = cur.lanes[action.laneIdx];
      if (!lane) return state;
      lane.stance = action.stance;
      return cloned;
    }

    case 'SET_LANE_SORT': {
      const lane = cur.lanes[action.laneIdx];
      if (!lane) return state;
      lane.sort = action.sort;
      return cloned;
    }

    case 'ADD_PRINCIPLE': {
      cur.principles.push(action.principle);
      return cloned;
    }

    case 'SET_PRINCIPLE': {
      cur.principles[action.idx] = action.value;
      return cloned;
    }

    case 'REMOVE_PRINCIPLE': {
      cur.principles.splice(action.idx, 1);
      return cloned;
    }

    case 'ZOOM_INTO': {
      cloned.path = [...cloned.path, action.cardId];
      cloned.openArchive = null;
      return cloned;
    }

    case 'ZOOM_TO': {
      cloned.path = cloned.path.slice(0, action.pathIdx + 1);
      cloned.openArchive = null;
      return cloned;
    }

    case 'RESTORE_ARCHIVED': {
      const aIdx = cur.archived.findIndex(a => a.id === action.archivedId);
      if (aIdx < 0) return state;
      const [archived] = cur.archived.splice(aIdx, 1);
      const restored = archived.node;
      restored.status = 'todo';
      restored.laneId = archived.laneId;
      cur.cards.unshift(restored);
      cloned.openArchive = null;
      return cloned;
    }

    case 'SET_OPEN_ARCHIVE': {
      // Action.laneIdx is number | null; openArchive is now string | null.
      // Transitional: convert to string (Phase 7 removes this reducer).
      cloned.openArchive = action.laneIdx !== null ? String(action.laneIdx) : null;
      return cloned;
    }

    default:
      return state;
  }
}

export function cycleSortMode(current: SortMode | undefined): SortMode {
  if (current === 'manual') return 'newest';
  if (current === 'newest') return 'oldest';
  return 'manual';
}
