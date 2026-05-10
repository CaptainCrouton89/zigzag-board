import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import { generateKeyBetween } from 'fractional-indexing'
import type { CardStatus, LaneType, SortMode } from './types'

export const ORIGIN_LOCAL = 'local'

// ---- Y subtree shapes (runtime — Y.Map keyed by string id) ----
// rootMap: Y.Map<unknown>      // ydoc.getMap('root')
//   id: string                 // 'root'
//   title: string
//   principles: Y.Array<string>
//   archived: Y.Array<Y.Map<unknown>>
//   lanes: Y.Map<Y.Map<unknown>>           // keyed by laneId
//   cards: Y.Map<Y.Map<unknown>>           // keyed by cardId (recursive)
//
// laneMap: Y.Map<unknown>
//   id: string; title: string; type: 'saga'|'backlog'
//   stance?: string; sort?: SortMode; order: string
//
// cardMap: Y.Map<unknown>      // same shape as rootMap but with extra fields:
//   id, title, status, laneId, order, createdAt
//   plus principles, archived, lanes, cards
//
// archivedItemMap: Y.Map<unknown>
//   id: string; title: string; laneId: string
//   node: Record<string, unknown>           // plain JSON snapshot from cardMap.toJSON()

// ---- helpers (private) ----
function getNodeYMapByPath(rootMap: Y.Map<unknown>, path: string[]): Y.Map<unknown> {
  // path[0] is always 'root'. Walk parent.cards.get(path[i]) for i ≥ 1.
  let node = rootMap
  for (let i = 1; i < path.length; i++) {
    const cards = node.get('cards')
    if (!(cards instanceof Y.Map)) return rootMap                  // stale path → bail to root
    const next = (cards as Y.Map<Y.Map<unknown>>).get(path[i])
    if (!(next instanceof Y.Map)) return rootMap
    node = next
  }
  return node
}

function lanesSorted(parent: Y.Map<unknown>): Y.Map<unknown>[] {
  const lanes = parent.get('lanes')
  if (!(lanes instanceof Y.Map)) return []
  const arr: Y.Map<unknown>[] = []
  ;(lanes as Y.Map<Y.Map<unknown>>).forEach(l => arr.push(l))
  // Id-tiebreaker (R-FE-2): identical `order` strings across peers (concurrent
  // inserts with identical neighbors → identical generateKeyBetween output)
  // would otherwise pick different "previous" siblings on each peer because
  // Y.Map iteration order is CRDT-merge-order and is NOT identical across
  // peers. The tiebreaker forces a deterministic neighbor-pair when computing
  // the next fractional key — so generateKeyBetween's input is stable across
  // peers, and the stored `order` converges via Y.Map LWW.
  //
  // CRITICAL: comparator MUST use `<`/`>` (UTF-16 code-unit) — NOT
  // localeCompare — to match snapshot.ts's render-order comparator. The
  // fractional-indexing library produces uppercase-headed keys (e.g. 'Zz')
  // for keys before the smallest existing key; localeCompare (Intl) sorts
  // 'Zz' AFTER 'a0' while `<` correctly sorts 'Zz' BEFORE 'a0'. Divergence
  // produces duplicate fractional keys on consecutive drag-to-top operations.
  arr.sort((a, b) => {
    const ao = String(a.get('order')); const bo = String(b.get('order'))
    if (ao < bo) return -1
    if (ao > bo) return 1
    const aid = String(a.get('id')); const bid = String(b.get('id'))
    return aid < bid ? -1 : aid > bid ? 1 : 0
  })
  return arr
}

function siblingsByLane(parent: Y.Map<unknown>, laneId: string): Y.Map<unknown>[] {
  const cards = parent.get('cards')
  if (!(cards instanceof Y.Map)) return []
  const arr: Y.Map<unknown>[] = []
  ;(cards as Y.Map<Y.Map<unknown>>).forEach(c => {
    if (c.get('laneId') === laneId) arr.push(c)
  })
  // Id-tiebreaker (R-FE-2) — same rationale as lanesSorted. MUST use `<`/`>`
  // (UTF-16) to match snapshot.ts; localeCompare diverges on uppercase-headed
  // fractional keys (e.g. 'Zz' before 'a0').
  arr.sort((a, b) => {
    const ao = String(a.get('order')); const bo = String(b.get('order'))
    if (ao < bo) return -1
    if (ao > bo) return 1
    const aid = String(a.get('id')); const bid = String(b.get('id'))
    return aid < bid ? -1 : aid > bid ? 1 : 0
  })
  return arr
}

function findCardYMap(
  parent: Y.Map<unknown>,
  cardId: string,
): Y.Map<unknown> | null {
  const cards = parent.get('cards')
  if (!(cards instanceof Y.Map)) return null
  const c = (cards as Y.Map<Y.Map<unknown>>).get(cardId)
  return c instanceof Y.Map ? c : null
}

// Trust boundary note: archived snapshots arrive from peer Y.Doc updates
// (any org member can write). M4 mitigation: depth bound prevents a malicious
// peer from crafting an archived item with cards.cards.cards…. nested 50k deep
// that would blow the stack on every peer that calls restoreArchived (or
// snapshots into it). 64 is well past any human-reachable nesting; depth-
// bombed restores collapse to an empty Y.Map at the bound, no crash.
const CARD_FROM_SNAPSHOT_MAX_DEPTH = 64

function cardFromSnapshot(snap: Record<string, unknown>, depth = 0): Y.Map<unknown> {
  // Depth bound (M4): peer-DoS-resistant.
  if (depth > CARD_FROM_SNAPSHOT_MAX_DEPTH) return new Y.Map<unknown>()
  // Rebuild a fresh card Y.Map (and its recursive subtree) from a plain JSON
  // snapshot produced earlier by Y.Map.toJSON(). Used by restoreArchived.
  const card = new Y.Map<unknown>()
  card.set('id', String(snap.id))
  card.set('title', snap.title !== undefined ? String(snap.title) : '')
  card.set('status', snap.status !== undefined ? (snap.status as CardStatus) : 'todo')
  card.set('laneId', snap.laneId !== undefined ? String(snap.laneId) : '')
  card.set('order', snap.order !== undefined ? String(snap.order) : 'a0')
  card.set('createdAt', snap.createdAt !== undefined ? Number(snap.createdAt) : Date.now())

  const principles = new Y.Array<string>()
  if (Array.isArray(snap.principles)) {
    principles.push((snap.principles as string[]).map(String))
  }
  card.set('principles', principles)

  const archived = new Y.Array<Y.Map<unknown>>()
  if (Array.isArray(snap.archived)) {
    for (const a of snap.archived as Array<Record<string, unknown>>) {
      const item = new Y.Map<unknown>()
      item.set('id', String(a.id))
      item.set('title', String(a.title))
      item.set('laneId', String(a.laneId))
      item.set('node', a.node)                    // plain JSON; not re-Y-ified
      archived.push([item])
    }
  }
  card.set('archived', archived)

  const lanes = new Y.Map<Y.Map<unknown>>()
  if (snap.lanes && typeof snap.lanes === 'object') {
    for (const [lid, lraw] of Object.entries(snap.lanes as Record<string, Record<string, unknown>>)) {
      const lm = new Y.Map<unknown>()
      lm.set('id', String(lraw.id ?? lid))
      lm.set('title', String(lraw.title ?? ''))
      lm.set('type', (lraw.type as LaneType) ?? 'saga')
      if (lraw.stance !== undefined) lm.set('stance', String(lraw.stance))
      if (lraw.sort !== undefined) lm.set('sort', lraw.sort as SortMode)
      lm.set('order', String(lraw.order ?? 'a0'))
      lanes.set(lid, lm)
    }
  }
  card.set('lanes', lanes)

  const cards = new Y.Map<Y.Map<unknown>>()
  if (snap.cards && typeof snap.cards === 'object') {
    for (const [cid, craw] of Object.entries(snap.cards as Record<string, Record<string, unknown>>)) {
      cards.set(cid, cardFromSnapshot(craw, depth + 1))
    }
  }
  card.set('cards', cards)

  return card
}

// ---------- ADD_CARD ----------
export function addCard(
  ydoc: Y.Doc, path: string[],
  laneId: string, rank: number, title: string,
): void {
  ydoc.transact(() => {
    const root = ydoc.getMap('root') as Y.Map<unknown>
    const parent = getNodeYMapByPath(root, path)
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const lane = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
    if (!lane) return

    const sibs = siblingsByLane(parent, laneId)
    const clamped = Math.max(0, Math.min(sibs.length, rank))
    const prev = clamped > 0 ? sibs[clamped - 1] : null
    const next = clamped < sibs.length ? sibs[clamped] : null
    const order = generateKeyBetween(
      prev ? String(prev.get('order')) : null,
      next ? String(next.get('order')) : null,
    )

    const id = `c-${nanoid(10)}`
    const card = new Y.Map<unknown>()
    card.set('id', id)
    card.set('title', title)
    card.set('status', 'todo' as CardStatus)
    card.set('laneId', laneId)
    card.set('order', order)
    card.set('createdAt', Date.now())
    card.set('principles', new Y.Array<string>())
    card.set('archived', new Y.Array<Y.Map<unknown>>())
    card.set('lanes', new Y.Map<Y.Map<unknown>>())
    card.set('cards', new Y.Map<Y.Map<unknown>>())

    let cards = parent.get('cards')
    if (!(cards instanceof Y.Map)) {
      cards = new Y.Map<Y.Map<unknown>>()
      parent.set('cards', cards)
    }
    ;(cards as Y.Map<Y.Map<unknown>>).set(id, card)
  }, ORIGIN_LOCAL)
}

// ---------- MOVE_CARD ----------
export function moveCard(
  ydoc: Y.Doc, path: string[],
  cardId: string, newLaneId: string, newRank: number,
): void {
  ydoc.transact(() => {
    const root = ydoc.getMap('root') as Y.Map<unknown>
    const parent = getNodeYMapByPath(root, path)
    const card = findCardYMap(parent, cardId)
    if (!card) return
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    if (!(lanes as Y.Map<Y.Map<unknown>>).get(newLaneId)) return

    // Recompute siblings AFTER conceptually removing this card from the lane it
    // currently sits in (so cross-lane and same-lane moves both behave
    // correctly — sibling list excludes the card being moved).
    const sibs = siblingsByLane(parent, newLaneId).filter(s => s.get('id') !== cardId)
    const clamped = Math.max(0, Math.min(sibs.length, newRank))
    const prev = clamped > 0 ? sibs[clamped - 1] : null
    const next = clamped < sibs.length ? sibs[clamped] : null
    const order = generateKeyBetween(
      prev ? String(prev.get('order')) : null,
      next ? String(next.get('order')) : null,
    )

    card.set('laneId', newLaneId)
    card.set('order', order)
  }, ORIGIN_LOCAL)
}

// ---------- SET_STATUS ----------
export function setStatus(ydoc: Y.Doc, path: string[], cardId: string): void {
  ydoc.transact(() => {
    const root = ydoc.getMap('root') as Y.Map<unknown>
    const parent = getNodeYMapByPath(root, path)
    const card = findCardYMap(parent, cardId)
    if (!card) return
    const status = card.get('status') as CardStatus
    if (status === 'todo') {
      card.set('status', 'doing')
      return
    }
    if (status === 'doing') {
      // doing → done: snapshot to plain JSON (option a), push into archived
      // Y.Array as a Y.Map wrapper, then delete the live card.
      const snap = card.toJSON() as Record<string, unknown>
      let archived = parent.get('archived')
      if (!(archived instanceof Y.Array)) {
        archived = new Y.Array<Y.Map<unknown>>()
        parent.set('archived', archived)
      }
      const item = new Y.Map<unknown>()
      item.set('id', String(card.get('id')))
      item.set('title', String(card.get('title')))
      item.set('laneId', String(card.get('laneId')))
      item.set('node', snap)
      ;(archived as Y.Array<Y.Map<unknown>>).push([item])

      const cards = parent.get('cards')
      if (cards instanceof Y.Map) {
        ;(cards as Y.Map<Y.Map<unknown>>).delete(String(card.get('id')))
      }
    }
    // done → ? — N/A: archived items are not reachable as live cards.
  }, ORIGIN_LOCAL)
}

// ---------- REVERT_STATUS ----------
export function revertStatus(ydoc: Y.Doc, path: string[], cardId: string): void {
  ydoc.transact(() => {
    const card = findCardYMap(getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path), cardId)
    if (card) card.set('status', 'todo')
  }, ORIGIN_LOCAL)
}

// ---------- SET_CARD_TITLE ----------
export function setCardTitle(ydoc: Y.Doc, path: string[], cardId: string, title: string): void {
  ydoc.transact(() => {
    const card = findCardYMap(getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path), cardId)
    if (card) card.set('title', title)
  }, ORIGIN_LOCAL)
}

// ---------- ADD_LANE ----------
export function addLane(ydoc: Y.Doc, path: string[]): void {
  ydoc.transact(() => {
    const root = ydoc.getMap('root') as Y.Map<unknown>
    const parent = getNodeYMapByPath(root, path)
    let lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) {
      lanes = new Y.Map<Y.Map<unknown>>()
      parent.set('lanes', lanes)
    }
    const sorted = lanesSorted(parent)
    const lastOrder = sorted.length ? String(sorted[sorted.length - 1].get('order')) : null
    const order = generateKeyBetween(lastOrder, null)

    const id = `l-${nanoid(10)}`
    const lane = new Y.Map<unknown>()
    lane.set('id', id)
    lane.set('title', 'New direction')
    lane.set('type', 'saga' as LaneType)
    lane.set('stance', '')
    lane.set('order', order)
    ;(lanes as Y.Map<Y.Map<unknown>>).set(id, lane)
    // Intentionally NO normalize-write (R6.10) — render-time pure transform.
  }, ORIGIN_LOCAL)
}

// ---------- TOGGLE_LANE_TYPE ----------
export function toggleLaneType(ydoc: Y.Doc, path: string[], laneId: string): void {
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const lane = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
    if (!lane) return
    const cur = lane.get('type') as LaneType
    const next: LaneType = cur === 'saga' ? 'backlog' : 'saga'
    lane.set('type', next)
    if (next === 'backlog' && lane.get('sort') === undefined) {
      lane.set('sort', 'manual' as SortMode)
    }
    // Intentionally NO normalize-write (R6.10).
  }, ORIGIN_LOCAL)
}

// ---------- SET_LANE_TITLE / SET_LANE_STANCE / SET_LANE_SORT ----------
function setLaneField<K extends string, V>(
  ydoc: Y.Doc, path: string[], laneId: string, key: K, value: V,
): void {
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const lane = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
    if (lane) lane.set(key, value)
  }, ORIGIN_LOCAL)
}

export function setLaneTitle(ydoc: Y.Doc, path: string[], laneId: string, title: string): void {
  setLaneField(ydoc, path, laneId, 'title', title)
}
export function setLaneStance(ydoc: Y.Doc, path: string[], laneId: string, stance: string): void {
  setLaneField(ydoc, path, laneId, 'stance', stance)
}
export function setLaneSort(ydoc: Y.Doc, path: string[], laneId: string, sort: SortMode): void {
  setLaneField(ydoc, path, laneId, 'sort', sort)
}

// ---------- ADD_PRINCIPLE / SET_PRINCIPLE / REMOVE_PRINCIPLE ----------
export function addPrinciple(ydoc: Y.Doc, path: string[], value: string): void {
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    let principles = parent.get('principles')
    if (!(principles instanceof Y.Array)) {
      principles = new Y.Array<string>()
      parent.set('principles', principles)
    }
    ;(principles as Y.Array<string>).push([value])
  }, ORIGIN_LOCAL)
}

export function setPrinciple(ydoc: Y.Doc, path: string[], idx: number, value: string): void {
  // Y.Array has no set(idx, v); replace = delete + insert in one transact.
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const principles = parent.get('principles')
    if (!(principles instanceof Y.Array)) return
    const arr = principles as Y.Array<string>
    if (idx < 0 || idx >= arr.length) return
    arr.delete(idx, 1)
    arr.insert(idx, [value])
  }, ORIGIN_LOCAL)
}

export function removePrinciple(ydoc: Y.Doc, path: string[], idx: number): void {
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const principles = parent.get('principles')
    if (!(principles instanceof Y.Array)) return
    const arr = principles as Y.Array<string>
    if (idx < 0 || idx >= arr.length) return
    arr.delete(idx, 1)
  }, ORIGIN_LOCAL)
}

// ---------- RESTORE_ARCHIVED ----------
export function restoreArchived(ydoc: Y.Doc, path: string[], archivedId: string): void {
  ydoc.transact(() => {
    const root = ydoc.getMap('root') as Y.Map<unknown>
    const parent = getNodeYMapByPath(root, path)
    const archived = parent.get('archived')
    if (!(archived instanceof Y.Array)) return
    const arr = archived as Y.Array<Y.Map<unknown>>

    let foundIdx = -1
    let found: Y.Map<unknown> | null = null
    for (let i = 0; i < arr.length; i++) {
      const item = arr.get(i)
      if (item instanceof Y.Map && item.get('id') === archivedId) {
        foundIdx = i
        found = item
        break
      }
    }
    if (!found || foundIdx < 0) return

    const snap = found.get('node') as Record<string, unknown>
    const archivedLaneId = String(found.get('laneId'))

    // Validate target lane still exists; fall back to first lane sorted by
    // (order, saga-first) if not.
    const lanes = parent.get('lanes')
    let targetLaneId = archivedLaneId
    if (!(lanes instanceof Y.Map) || !(lanes as Y.Map<Y.Map<unknown>>).get(archivedLaneId)) {
      const sorted = lanesSorted(parent)
      const sagas = sorted.filter(l => l.get('type') === 'saga')
      const fallback = sagas[0] ?? sorted[0]
      if (!fallback) return       // no lanes exist — nothing to restore into
      targetLaneId = String(fallback.get('id'))
    }

    // Compute fresh order at end of target lane.
    const sibs = siblingsByLane(parent, targetLaneId)
    const lastOrder = sibs.length ? String(sibs[sibs.length - 1].get('order')) : null
    const newOrder = generateKeyBetween(lastOrder, null)

    // Mutate the snapshot in-place before reifying — restored cards always
    // come back as 'todo', under the validated lane, with a fresh order.
    snap.status = 'todo'
    snap.laneId = targetLaneId
    snap.order = newOrder

    const restored = cardFromSnapshot(snap)
    let cards = parent.get('cards')
    if (!(cards instanceof Y.Map)) {
      cards = new Y.Map<Y.Map<unknown>>()
      parent.set('cards', cards)
    }
    ;(cards as Y.Map<Y.Map<unknown>>).set(String(restored.get('id')), restored)

    arr.delete(foundIdx, 1)
  }, ORIGIN_LOCAL)
}
