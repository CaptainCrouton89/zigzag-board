import * as Y from 'yjs'
import type { AppState, Card, Lane, ArchivedItem, LaneType, CardStatus, SortMode } from './types'

export function buildSnapshot(ydoc: Y.Doc, path: string[], openArchive: string | null): AppState {
  const rootMap = ydoc.getMap('root')
  const root = mapToCard(rootMap as Y.Map<unknown>, /* isRoot */ true)
  return { root, path, openArchive }
}

function mapToCard(m: Y.Map<unknown>, isRoot = false): Card {
  // 1. lanes: read from m.get('lanes') Y.Map<Y.Map>, sort by order, partition saga-first.
  const lanesMap = m.get('lanes') as Y.Map<Y.Map<unknown>> | undefined
  let lanes: Lane[] = []
  if (lanesMap) {
    const all: Lane[] = []
    lanesMap.forEach(laneM => all.push(mapToLane(laneM)))
    // Id-tiebreaker (R-FE-2): identical `order` strings under concurrent
    // inserts → each peer's local Y.Map iteration order (= CRDT-merge order,
    // NOT identical across peers) leaks into render position without this.
    // Sort stability + React `key={id}` are NOT sufficient — `key` controls
    // reconciliation identity, not array position. Tiebreaker MUST match
    // mutations.ts `lanesSorted` so neighbor-pair selection in
    // generateKeyBetween stays in lock-step with render order.
    all.sort((a, b) =>
      a.order < b.order ? -1 :
      a.order > b.order ? 1 :
      a.id < b.id ? -1 :
      a.id > b.id ? 1 : 0
    )
    const sagas = all.filter(l => l.type === 'saga')
    const backlogs = all.filter(l => l.type === 'backlog')
    lanes = [...sagas, ...backlogs]
  }
  // R-FE-9: do NOT synthesize a fallback lane here. Phase-4 server seed
  // (SEED_LANE_ID = 'lane-default') is the authoritative source; every fresh
  // org's Y.Doc is non-empty on first sync. Synthesizing a client-local lane
  // would mint an id not in the Y.Doc — any mutation against it (onAddCard,
  // etc.) would silently miss. The brief pre-sync window where lanes is
  // empty is handled at Board.tsx render time via boardW = Math.max(0, …)
  // (M5). KEEP this comment in implementation as a future-edit warning.

  // 2. cards: read from m.get('cards') Y.Map<Y.Map>, sort by order.
  const cardsMap = m.get('cards') as Y.Map<Y.Map<unknown>> | undefined
  const cards: Card[] = []
  if (cardsMap) {
    cardsMap.forEach(cardM => cards.push(mapToCard(cardM)))
    // Id-tiebreaker (R-FE-2): see lanes-sort comment above. Match
    // mutations.ts `siblingsByLane` so neighbor-pair selection is consistent.
    cards.sort((a, b) =>
      a.order < b.order ? -1 :
      a.order > b.order ? 1 :
      a.id < b.id ? -1 :
      a.id > b.id ? 1 : 0
    )
  }

  // 3. principles: read Y.Array<string>.
  const principlesArr = m.get('principles') as Y.Array<string> | undefined
  const principles: string[] = principlesArr ? principlesArr.toArray() : []

  // 4. archived: read Y.Array<Y.Map>, snapshot each entry.
  const archivedArr = m.get('archived') as Y.Array<Y.Map<unknown>> | undefined
  const archived: ArchivedItem[] = []
  if (archivedArr) {
    archivedArr.forEach(aM => archived.push(mapToArchived(aM)))
  }

  return {
    id: (m.get('id') as string | undefined) !== undefined ? (m.get('id') as string) : (isRoot ? 'root' : ''),
    title: (m.get('title') as string | undefined) !== undefined ? (m.get('title') as string) : '',
    status: (m.get('status') as CardStatus | undefined) !== undefined ? (m.get('status') as CardStatus) : 'todo',
    laneId: (m.get('laneId') as string | undefined) !== undefined ? (m.get('laneId') as string) : '',
    order: (m.get('order') as string | undefined) !== undefined ? (m.get('order') as string) : '',
    createdAt: (m.get('createdAt') as number | undefined) !== undefined ? (m.get('createdAt') as number) : 0,
    lanes, cards, principles, archived,
  }
}

function mapToLane(m: Y.Map<unknown>): Lane {
  return {
    id: (m.get('id') as string | undefined) !== undefined ? (m.get('id') as string) : '',
    title: (m.get('title') as string | undefined) !== undefined ? (m.get('title') as string) : '',
    type: (m.get('type') as LaneType | undefined) !== undefined ? (m.get('type') as LaneType) : 'saga',
    stance: m.get('stance') as string | undefined,
    sort: m.get('sort') as SortMode | undefined,
    order: (m.get('order') as string | undefined) !== undefined ? (m.get('order') as string) : '',
  }
}

function mapToArchived(m: Y.Map<unknown>): ArchivedItem {
  // Per design.md §4.4 option (a): archived.node is a plain JSON snapshot,
  // NOT a live Y.Map. So m.get('node') returns the plain JS object.
  return {
    id: (m.get('id') as string | undefined) !== undefined ? (m.get('id') as string) : '',
    title: (m.get('title') as string | undefined) !== undefined ? (m.get('title') as string) : '',
    laneId: (m.get('laneId') as string | undefined) !== undefined ? (m.get('laneId') as string) : '',
    node: m.get('node') as Card,
  }
}
