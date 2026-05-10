// Server-side port of /src/lib/board/mutations.ts. Web client and server
// must stay byte-identical on these functions because both write into the
// same shared Y.Doc — divergence produces silent CRDT-merge corruption.
//
// Server-only additions: removeCard / removeLane (the web app archives
// cards and never hard-deletes lanes; the CLI exposes hard delete because
// users running scripted operations need a way to undo mistakes without
// going through the archive flow).
import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import { generateKeyBetween } from 'fractional-indexing'
import type { CardStatus, LaneType, SortMode } from './types.js'

export const ORIGIN_LOCAL = 'local'

function getNodeYMapByPath(rootMap: Y.Map<unknown>, path: string[]): Y.Map<unknown> {
  let node = rootMap
  for (let i = 1; i < path.length; i++) {
    const cards = node.get('cards')
    if (!(cards instanceof Y.Map)) return rootMap
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
  // CRITICAL: comparator MUST use UTF-16 code-unit `<`/`>` — NOT
  // localeCompare — to match the web copy's snapshot.ts comparator.
  // Diverging here produces duplicate fractional keys on consecutive
  // drag-to-top operations across web/server writers.
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
  arr.sort((a, b) => {
    const ao = String(a.get('order')); const bo = String(b.get('order'))
    if (ao < bo) return -1
    if (ao > bo) return 1
    const aid = String(a.get('id')); const bid = String(b.get('id'))
    return aid < bid ? -1 : aid > bid ? 1 : 0
  })
  return arr
}

// Saga cards across ALL saga lanes share one global zigzag rank space.
// addCard/moveCard for saga destinations must resolve neighbors against
// this global list — not the per-lane sibling list — or drops collapse
// to the destination lane's local end. Mirrors the web copy.
function sagaSiblings(parent: Y.Map<unknown>): Y.Map<unknown>[] {
  const lanes = parent.get('lanes')
  const cards = parent.get('cards')
  if (!(lanes instanceof Y.Map) || !(cards instanceof Y.Map)) return []
  const sagaLaneIds = new Set<string>()
  ;(lanes as Y.Map<Y.Map<unknown>>).forEach((laneM, lid) => {
    if (laneM.get('type') === 'saga') sagaLaneIds.add(lid)
  })
  const arr: Y.Map<unknown>[] = []
  ;(cards as Y.Map<Y.Map<unknown>>).forEach(c => {
    const lid = c.get('laneId')
    if (typeof lid === 'string' && sagaLaneIds.has(lid)) arr.push(c)
  })
  arr.sort((a, b) => {
    const ao = String(a.get('order')); const bo = String(b.get('order'))
    if (ao < bo) return -1
    if (ao > bo) return 1
    const aid = String(a.get('id')); const bid = String(b.get('id'))
    return aid < bid ? -1 : aid > bid ? 1 : 0
  })
  return arr
}

function isSagaLane(parent: Y.Map<unknown>, laneId: string): boolean {
  const lanes = parent.get('lanes')
  if (!(lanes instanceof Y.Map)) return false
  const lane = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
  return lane?.get('type') === 'saga'
}

function findCardYMap(parent: Y.Map<unknown>, cardId: string): Y.Map<unknown> | null {
  const cards = parent.get('cards')
  if (!(cards instanceof Y.Map)) return null
  const c = (cards as Y.Map<Y.Map<unknown>>).get(cardId)
  return c instanceof Y.Map ? c : null
}

// Resolve a CLI-style position spec into a (prev, next) sibling pair so
// generateKeyBetween produces a fractional key at the correct slot.
// Caller has already chosen the right sibling list (sagaSiblings vs
// siblingsByLane vs lanesSorted) and filtered out a card being moved.
function resolveNeighbors(
  sibs: Y.Map<unknown>[],
  before: string | null,
  after: string | null,
): { prev: Y.Map<unknown> | null; next: Y.Map<unknown> | null } {
  if (before) {
    const idx = sibs.findIndex(s => s.get('id') === before)
    if (idx >= 0) return { prev: idx > 0 ? sibs[idx - 1] : null, next: sibs[idx] }
  }
  if (after) {
    const idx = sibs.findIndex(s => s.get('id') === after)
    if (idx >= 0) return { prev: sibs[idx], next: idx < sibs.length - 1 ? sibs[idx + 1] : null }
  }
  // Default: append to end.
  return { prev: sibs.length > 0 ? sibs[sibs.length - 1] : null, next: null }
}

// ---------- ADD_CARD (returns the created id) ----------
export function addCardAt(
  ydoc: Y.Doc, path: string[],
  laneId: string, text: string,
  before: string | null, after: string | null,
): string {
  const id = `c-${nanoid(10)}`
  ydoc.transact(() => {
    const root = ydoc.getMap('root') as Y.Map<unknown>
    const parent = getNodeYMapByPath(root, path)
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const lane = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
    if (!lane) return

    const sibs = isSagaLane(parent, laneId)
      ? sagaSiblings(parent)
      : siblingsByLane(parent, laneId)
    const { prev, next } = resolveNeighbors(sibs, before, after)
    const order = generateKeyBetween(
      prev ? String(prev.get('order')) : null,
      next ? String(next.get('order')) : null,
    )

    const card = new Y.Map<unknown>()
    card.set('id', id)
    card.set('title', text)
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
  return id
}

// ---------- MOVE_CARD ----------
export function moveCardTo(
  ydoc: Y.Doc, path: string[],
  cardId: string, newLaneId: string | null,
  before: string | null, after: string | null,
): boolean {
  let ok = false
  ydoc.transact(() => {
    const root = ydoc.getMap('root') as Y.Map<unknown>
    const parent = getNodeYMapByPath(root, path)
    const card = findCardYMap(parent, cardId)
    if (!card) return
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const targetLaneId = newLaneId !== null ? newLaneId : String(card.get('laneId'))
    if (!(lanes as Y.Map<Y.Map<unknown>>).get(targetLaneId)) return

    const sibs = (isSagaLane(parent, targetLaneId)
      ? sagaSiblings(parent)
      : siblingsByLane(parent, targetLaneId)
    ).filter(s => s.get('id') !== cardId)
    const { prev, next } = resolveNeighbors(sibs, before, after)
    const order = generateKeyBetween(
      prev ? String(prev.get('order')) : null,
      next ? String(next.get('order')) : null,
    )

    card.set('laneId', targetLaneId)
    card.set('order', order)
    ok = true
  }, ORIGIN_LOCAL)
  return ok
}

// ---------- SET_CARD_TITLE ----------
export function setCardTitle(ydoc: Y.Doc, path: string[], cardId: string, title: string): boolean {
  let ok = false
  ydoc.transact(() => {
    const card = findCardYMap(getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path), cardId)
    if (card) {
      card.set('title', title)
      ok = true
    }
  }, ORIGIN_LOCAL)
  return ok
}

// ---------- REMOVE_CARD (hard delete; CLI-only) ----------
// The web app never hard-deletes; cards archive via setStatus. CLI users
// scripting bulk operations need a way to undo a stray `card add` without
// the archive UI side-effects, so this primitive exists server-side only.
export function removeCard(ydoc: Y.Doc, path: string[], cardId: string): boolean {
  let ok = false
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const cards = parent.get('cards')
    if (!(cards instanceof Y.Map)) return
    const cm = cards as Y.Map<Y.Map<unknown>>
    if (!cm.has(cardId)) return
    cm.delete(cardId)
    ok = true
  }, ORIGIN_LOCAL)
  return ok
}

// ---------- ADD_LANE (returns the created id) ----------
export function addLaneAt(
  ydoc: Y.Doc, path: string[],
  name: string, type: LaneType,
): string {
  const id = `l-${nanoid(10)}`
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

    const lane = new Y.Map<unknown>()
    lane.set('id', id)
    lane.set('title', name)
    lane.set('type', type)
    lane.set('stance', '')
    lane.set('order', order)
    if (type === 'backlog') lane.set('sort', 'manual' as SortMode)
    ;(lanes as Y.Map<Y.Map<unknown>>).set(id, lane)
  }, ORIGIN_LOCAL)
  return id
}

// ---------- SET_LANE_TYPE ----------
export function setLaneType(ydoc: Y.Doc, path: string[], laneId: string, type: LaneType): boolean {
  let ok = false
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const lane = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
    if (!lane) return
    lane.set('type', type)
    if (type === 'backlog' && lane.get('sort') === undefined) {
      lane.set('sort', 'manual' as SortMode)
    }
    ok = true
  }, ORIGIN_LOCAL)
  return ok
}

// ---------- SET_LANE_TITLE ----------
export function setLaneTitle(ydoc: Y.Doc, path: string[], laneId: string, title: string): boolean {
  let ok = false
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const lane = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
    if (!lane) return
    lane.set('title', title)
    ok = true
  }, ORIGIN_LOCAL)
  return ok
}

// ---------- REMOVE_LANE (hard delete; refuses non-empty lanes) ----------
// Cards reference laneId by string — orphan cards with a stale laneId
// would render in no lane until the user reassigns them. Refusing the
// delete forces the caller to move/archive cards first, which is the
// same invariant the web UI enforces by simply not exposing delete.
// Returns: 'ok' | 'not_found' | 'non_empty'.
export function removeLane(
  ydoc: Y.Doc, path: string[], laneId: string,
): 'ok' | 'not_found' | 'non_empty' {
  let result: 'ok' | 'not_found' | 'non_empty' = 'not_found'
  ydoc.transact(() => {
    const parent = getNodeYMapByPath(ydoc.getMap('root') as Y.Map<unknown>, path)
    const lanes = parent.get('lanes')
    if (!(lanes instanceof Y.Map)) return
    const lm = lanes as Y.Map<Y.Map<unknown>>
    if (!lm.has(laneId)) return
    const cards = parent.get('cards')
    if (cards instanceof Y.Map) {
      let nonEmpty = false
      ;(cards as Y.Map<Y.Map<unknown>>).forEach(c => {
        if (c.get('laneId') === laneId) nonEmpty = true
      })
      if (nonEmpty) {
        result = 'non_empty'
        return
      }
    }
    lm.delete(laneId)
    result = 'ok'
  }, ORIGIN_LOCAL)
  return result
}

// ---------- READ: serialize board to JSON ----------
// Returns the shape board.ts hands back to the CLI: lanes ordered by their
// fractional key; cards inside each lane ordered by their key (with the
// id-tiebreaker that mirrors the web's render comparator).
export type CardJson = { id: string; text: string; status: CardStatus; order: string }
export type LaneJson = { id: string; name: string; type: LaneType; cards: CardJson[] }

export function readBoard(ydoc: Y.Doc): { lanes: LaneJson[] } {
  // Trust the Y.Doc shape: every lane and card has the canonical fields
  // populated by addLaneAt / addCardAt or seeded by hocuspocus.ts. The
  // web copy of these functions casts identically without fallbacks; if
  // the shape ever drifts, the cast surfaces a runtime mismatch loudly
  // rather than silently substituting "" or "saga".
  const root = ydoc.getMap('root') as Y.Map<unknown>
  const lanes = lanesSorted(root)
  return {
    lanes: lanes.map(l => {
      const laneId = String(l.get('id'))
      const sibs = siblingsByLane(root, laneId)
      return {
        id: laneId,
        name: String(l.get('title')),
        type: l.get('type') as LaneType,
        cards: sibs.map(c => ({
          id: String(c.get('id')),
          text: String(c.get('title')),
          status: c.get('status') as CardStatus,
          order: String(c.get('order')),
        })),
      }
    }),
  }
}
