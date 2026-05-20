import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import * as Y from 'yjs'
import { db } from '../db/client.js'
import { member, organization } from '../db/schema.js'
import { requireSession, type AuthVariables } from '../middleware/requireSession.js'
import { withBoardDoc } from '../lib/board-mutate.js'
import {
  addCardAt, moveCardTo, setCardTitle, removeCard,
  addLaneAt, setLaneTitle, setLaneType, removeLane,
  setCardStatus, restoreArchived, moveLane,
  readBoard,
  type LaneJson,
  type ArchivedJson,
} from '../lib/board/mutations.js'
import type { LaneType, CardStatus } from '../lib/board/types.js'

// Org id header. Cookie-only sessions can use session.activeOrganizationId;
// CLI bearer sessions are long-lived and would inherit a stale active org,
// so we require an explicit per-request choice. Authorization checks
// membership directly — mirrors hocuspocus.ts:46-54 ("active-org is a UI
// preference, not an authorization boundary").
const ORG_HEADER = 'x-org-id'

type BoardVars = AuthVariables & { orgId: string }

const app = new Hono<{ Variables: BoardVars }>()
app.use('*', requireSession)

// ---- Org-resolution middleware ----
// Reads X-Org-Id, verifies membership, stashes orgId on the context.
// Falls back to session.activeOrganizationId so a single-org user with no
// header doesn't have to send one.
app.use('*', async (c, next) => {
  const header = c.req.header(ORG_HEADER)
  const fromSession = c.var.session.activeOrganizationId
  const orgId = typeof header === 'string' && header.length > 0
    ? header
    : (typeof fromSession === 'string' && fromSession.length > 0 ? fromSession : null)

  if (orgId === null) {
    // Help the CLI guide the user. Listing orgs here keeps `zigzag board`
    // self-contained when no org has been chosen yet.
    const orgs = await db
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, c.var.user.id))
    return c.json({ error: 'no_active_org', orgs }, 409)
  }

  const m = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, c.var.user.id), eq(member.organizationId, orgId)))
    .limit(1)
  if (m.length === 0) return c.json({ error: 'forbidden' }, 403)

  c.set('orgId', orgId)
  await next()
})

// ---- Path helper ----
// Parses path from ?path= query (comma-joined) or body.path (string[]).
// Validates: non-empty string[], first element must be 'root'.
// Returns parsed path or an error response payload.
function parsePathFromQuery(raw: string | undefined): { path: string[] } | { invalid: unknown } {
  if (raw === undefined || raw === '') return { path: ['root'] }
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0 || parts[0] !== 'root') {
    return { invalid: parts.length === 0 ? raw : parts }
  }
  return { path: parts }
}

function parsePathFromBody(raw: unknown): { path: string[] } | { invalid: unknown } {
  if (raw === undefined || raw === null) return { path: ['root'] }
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every(s => typeof s === 'string') ||
    raw[0] !== 'root'
  ) {
    return { invalid: raw }
  }
  return { path: raw as string[] }
}

const INVALID_PATH_RESPONSE = (received: unknown) => ({
  error: 'invalid_path' as const,
  received,
  expected: 'string[] starting with "root"',
  next: 'Send path as ["root"] or ["root","<cardId>",...]',
})

// ---- READ ----
// GET /  ?path=root,c-abc,c-def  (comma-joined; default ['root'])
app.get('/', async (c) => {
  const parsed = parsePathFromQuery(c.req.query('path'))
  if ('invalid' in parsed) return c.json(INVALID_PATH_RESPONSE(parsed.invalid), 400)
  const { path } = parsed

  const data = await withBoardDoc(c.var.orgId, (doc) => readBoard(doc, path))
  if ('notFound' in data && data.notFound) {
    return c.json({
      error: 'path_not_found',
      received: path,
      next: 'verify each id with GET /api/board/cards/:id at a shallower path',
    }, 404)
  }
  return c.json({ orgId: c.var.orgId, path: data.path, lanes: data.lanes, archived: data.archived })
})

// ---- CARDS ----

// GET /cards/:id  — reads a single card plus its nested board
// ?path= is the parent path (defaults to root)
app.get('/cards/:id', async (c) => {
  const cardId = c.req.param('id')
  const parsed = parsePathFromQuery(c.req.query('path'))
  if ('invalid' in parsed) return c.json(INVALID_PATH_RESPONSE(parsed.invalid), 400)
  const parentPath = parsed.path

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const root = doc.getMap('root') as Y.Map<unknown>
    // Verify card exists at parent path
    const parentNode = getNodeByPath(root, parentPath)
    if (!parentNode) return { error: 'not_found' as const }
    const cards = parentNode.get('cards')
    if (!(cards instanceof Y.Map)) return { error: 'not_found' as const }
    const cardMap = (cards as Y.Map<Y.Map<unknown>>).get(cardId)
    if (!(cardMap instanceof Y.Map)) return { error: 'not_found' as const }

    const card = {
      id: String(cardMap.get('id')),
      text: String(cardMap.get('title')),
      status: cardMap.get('status') as CardStatus,
      laneId: String(cardMap.get('laneId')),
      order: String(cardMap.get('order')),
    }

    const nested = readBoard(doc, [...parentPath, cardId])
    if ('notFound' in nested && nested.notFound) return { error: 'not_found' as const }
    return { card, lanes: nested.lanes, archived: nested.archived }
  })

  if ('error' in result) {
    return c.json({
      error: 'not_found',
      received: { path: parentPath, cardId },
      next: 'list cards at the parent path with GET /api/board?path=...',
    }, 404)
  }
  return c.json(result)
})

type AddCardBody = { path?: string[]; laneId?: string; text?: string; before?: string; after?: string }
app.post('/cards', async (c) => {
  const body = await c.req.json<AddCardBody>().catch(() => ({} as AddCardBody))

  const parsedPath = parsePathFromBody(body.path)
  if ('invalid' in parsedPath) return c.json(INVALID_PATH_RESPONSE(parsedPath.invalid), 400)
  const path = parsedPath.path

  const laneId = typeof body.laneId === 'string' ? body.laneId : ''
  const text = typeof body.text === 'string' ? body.text : ''
  if (!laneId) return c.json({ error: 'missing_laneId', received: body, expected: 'laneId string', next: 'provide a laneId from GET /api/board' }, 400)
  if (!text.trim()) return c.json({ error: 'missing_text', received: body, expected: 'non-empty text string', next: 'provide a text field' }, 400)
  const before = typeof body.before === 'string' ? body.before : null
  const after = typeof body.after === 'string' ? body.after : null

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const root = doc.getMap('root') as Y.Map<unknown>
    const parentNode = getNodeByPath(root, path)
    if (!parentNode) {
      return { error: 'path_not_found' as const }
    }
    const lanes = parentNode.get('lanes')
    if (!(lanes instanceof Y.Map)) return { error: 'lane_not_found' as const }
    if (!(lanes as Y.Map<Y.Map<unknown>>).get(laneId)) return { error: 'lane_not_found' as const }
    const id = addCardAt(doc, path, laneId, text, before, after)
    return { card: snapshotCard(doc, path, id) }
  })
  if ('error' in result) {
    if (result.error === 'path_not_found') {
      return c.json({ error: 'path_not_found', received: path, next: 'verify each id with GET /api/board/cards/:id at a shallower path' }, 404)
    }
    return c.json({ error: result.error, received: { path, laneId }, expected: 'a valid laneId at the given path', next: 'list lanes with GET /api/board?path=...' }, 404)
  }
  return c.json(result, 201)
})

type PatchCardBody = {
  path?: string[]
  text?: string
  laneId?: string
  before?: string
  after?: string
  status?: string
}
app.patch('/cards/:id', async (c) => {
  const cardId = c.req.param('id')
  const body = await c.req.json<PatchCardBody>().catch(() => ({} as PatchCardBody))

  const parsedPath = parsePathFromBody(body.path)
  if ('invalid' in parsedPath) return c.json(INVALID_PATH_RESPONSE(parsedPath.invalid), 400)
  const path = parsedPath.path

  const text = typeof body.text === 'string' ? body.text : null
  const laneId = typeof body.laneId === 'string' ? body.laneId : null
  const before = typeof body.before === 'string' ? body.before : null
  const after = typeof body.after === 'string' ? body.after : null
  const statusRaw = typeof body.status === 'string' ? body.status : null
  const wantsMove = laneId !== null || before !== null || after !== null

  if (statusRaw !== null && statusRaw !== 'todo' && statusRaw !== 'doing' && statusRaw !== 'done') {
    return c.json({
      error: 'invalid_status',
      received: body.status,
      expected: ['todo', 'doing', 'done'],
      next: 'omit or use one of the three values',
    }, 400)
  }
  const status = statusRaw as CardStatus | null

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const root = doc.getMap('root') as Y.Map<unknown>
    const parentNode = getNodeByPath(root, path)
    if (!parentNode) return { error: 'not_found' as const }
    const cards = parentNode.get('cards')
    if (!(cards instanceof Y.Map)) return { error: 'not_found' as const }
    if (!(cards as Y.Map<Y.Map<unknown>>).get(cardId)) return { error: 'not_found' as const }

    if (text !== null) {
      if (!text.trim()) return { error: 'text_empty' as const }
      setCardTitle(doc, path, cardId, text)
    }
    if (wantsMove) {
      const ok = moveCardTo(doc, path, cardId, laneId, before, after)
      if (!ok) return { error: 'move_failed' as const }
    }
    if (status !== null) {
      // setCardStatus is a one-step progression (todo→doing, doing→done).
      // The CLI contract treats --status as a direct setter, so we tick
      // forward until current matches target. Backward transitions error.
      const order: CardStatus[] = ['todo', 'doing', 'done']
      const liveCard = (cards as Y.Map<Y.Map<unknown>>).get(cardId)
      const curStatus = liveCard ? (liveCard.get('status') as CardStatus) : null
      if (curStatus === null) return { error: 'not_found' as const }
      const curIdx = order.indexOf(curStatus)
      const tgtIdx = order.indexOf(status)
      if (tgtIdx < curIdx) {
        return { error: 'backward_status' as const, curStatus, requested: status }
      }
      for (let i = curIdx; i < tgtIdx; i++) {
        const outcome = setCardStatus(doc, path, cardId, status)
        if (outcome === 'not_found') return { error: 'not_found' as const }
      }
      if (status === 'done') {
        const stillExists = (cards as Y.Map<Y.Map<unknown>>).get(cardId)
        if (!stillExists) {
          const archived = parentNode.get('archived')
          if (archived instanceof Y.Array) {
            const arr = archived as Y.Array<Y.Map<unknown>>
            const len = arr.length
            if (len > 0) {
              const lastArchived = arr.get(len - 1)
              const archivedItemId = lastArchived instanceof Y.Map ? String(lastArchived.get('id')) : null
              return { archived: true, archivedItemId }
            }
          }
          return { archived: true, archivedItemId: null }
        }
      }
    }
    return { card: snapshotCard(doc, path, cardId) }
  })

  if ('error' in result) {
    if (result.error === 'backward_status') {
      return c.json({
        error: 'backward_status',
        message: 'card status only advances forward (todo → doing → done)',
        received: { current: result.curStatus, requested: result.requested },
        expected: 'a status at or after the current one',
        next: 'to bring a done card back, use POST /api/board/cards/:archivedItemId/restore',
      }, 400)
    }
    const httpStatus = result.error === 'not_found' ? 404 : 400
    return c.json({
      error: result.error,
      received: { path, cardId },
      next: result.error === 'not_found'
        ? 'list cards at this path with GET /api/board?path=...'
        : 'check request body',
    }, httpStatus)
  }
  return c.json(result)
})

app.delete('/cards/:id', async (c) => {
  const cardId = c.req.param('id')

  // Accept path from query or body
  let path: string[]
  const queryPath = c.req.query('path')
  if (queryPath !== undefined) {
    const parsed = parsePathFromQuery(queryPath)
    if ('invalid' in parsed) return c.json(INVALID_PATH_RESPONSE(parsed.invalid), 400)
    path = parsed.path
  } else {
    const body = await c.req.json<{ path?: string[] }>().catch(() => ({} as { path?: string[] }))
    const parsed = parsePathFromBody(body.path)
    if ('invalid' in parsed) return c.json(INVALID_PATH_RESPONSE(parsed.invalid), 400)
    path = parsed.path
  }

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    return removeCard(doc, path, cardId)
  })
  if (!result) return c.json({ error: 'not_found', received: { path, cardId }, next: 'list cards at this path with GET /api/board?path=...' }, 404)
  return c.json({ ok: true })
})

// POST /cards/:id/restore — restore an archived item by its archivedItemId
app.post('/cards/:id/restore', async (c) => {
  const archivedItemId = c.req.param('id')
  const body = await c.req.json<{ path?: string[] }>().catch(() => ({} as { path?: string[] }))

  const parsedPath = parsePathFromBody(body.path)
  if ('invalid' in parsedPath) return c.json(INVALID_PATH_RESPONSE(parsedPath.invalid), 400)
  const path = parsedPath.path

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const outcome = restoreArchived(doc, path, archivedItemId)
    if (outcome === 'not_found') return { error: 'not_found' as const }
    // Find the restored card by archivedItemId (which becomes its card id after restore)
    const card = snapshotCard(doc, path, archivedItemId)
    return { card }
  })

  if ('error' in result) {
    return c.json({
      error: 'not_found',
      received: { path, archivedItemId },
      next: 'list archived items via GET /api/board?path=...',
    }, 404)
  }
  return c.json(result)
})

// ---- LANES ----
type AddLaneBody = { path?: string[]; name?: string; type?: LaneType }
app.post('/lanes', async (c) => {
  const body = await c.req.json<AddLaneBody>().catch(() => ({} as AddLaneBody))

  const parsedPath = parsePathFromBody(body.path)
  if ('invalid' in parsedPath) return c.json(INVALID_PATH_RESPONSE(parsedPath.invalid), 400)
  const path = parsedPath.path

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return c.json({ error: 'missing_name', received: body, expected: 'non-empty name string', next: 'provide a name field' }, 400)
  const type: LaneType = body.type === 'backlog' ? 'backlog' : 'saga'

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const id = addLaneAt(doc, path, name, type)
    return { lane: snapshotLane(doc, path, id) }
  })
  return c.json(result, 201)
})

type PatchLaneBody = { path?: string[]; name?: string; type?: LaneType }
app.patch('/lanes/:id', async (c) => {
  const laneId = c.req.param('id')
  const body = await c.req.json<PatchLaneBody>().catch(() => ({} as PatchLaneBody))

  const parsedPath = parsePathFromBody(body.path)
  if ('invalid' in parsedPath) return c.json(INVALID_PATH_RESPONSE(parsedPath.invalid), 400)
  const path = parsedPath.path

  const name = typeof body.name === 'string' ? body.name.trim() : null
  const type = body.type === 'saga' || body.type === 'backlog' ? body.type : null
  if (name === null && type === null) return c.json({ error: 'no_changes', received: body, expected: 'at least one of name or type', next: 'provide name or type in the request body' }, 400)

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const root = doc.getMap('root') as Y.Map<unknown>
    const parentNode = getNodeByPath(root, path)
    if (!parentNode) return { error: 'path_not_found' as const }
    const lanes = parentNode.get('lanes')
    if (!(lanes instanceof Y.Map)) return { error: 'not_found' as const }
    if (!(lanes as Y.Map<Y.Map<unknown>>).get(laneId)) return { error: 'not_found' as const }

    if (name !== null) {
      if (!name) return { error: 'name_empty' as const }
      setLaneTitle(doc, path, laneId, name)
    }
    if (type !== null) {
      setLaneType(doc, path, laneId, type)
    }
    return { lane: snapshotLane(doc, path, laneId) }
  })
  if ('error' in result) {
    if (result.error === 'path_not_found') {
      return c.json({ error: 'path_not_found', received: path, next: 'verify each id with GET /api/board/cards/:id at a shallower path' }, 404)
    }
    const httpStatus = result.error === 'not_found' ? 404 : 400
    return c.json({
      error: result.error,
      received: { path, laneId },
      next: result.error === 'not_found' ? 'list lanes with GET /api/board?path=...' : 'check request body',
    }, httpStatus)
  }
  return c.json(result)
})

app.delete('/lanes/:id', async (c) => {
  const laneId = c.req.param('id')

  let path: string[]
  const queryPath = c.req.query('path')
  if (queryPath !== undefined) {
    const parsed = parsePathFromQuery(queryPath)
    if ('invalid' in parsed) return c.json(INVALID_PATH_RESPONSE(parsed.invalid), 400)
    path = parsed.path
  } else {
    const body = await c.req.json<{ path?: string[] }>().catch(() => ({} as { path?: string[] }))
    const parsed = parsePathFromBody(body.path)
    if ('invalid' in parsed) return c.json(INVALID_PATH_RESPONSE(parsed.invalid), 400)
    path = parsed.path
  }

  const outcome = await withBoardDoc(c.var.orgId, (doc) => {
    return removeLane(doc, path, laneId)
  })
  if (outcome === 'not_found') return c.json({ error: 'not_found', received: { path, laneId }, next: 'list lanes with GET /api/board?path=...' }, 404)
  if (outcome === 'non_empty') {
    return c.json({
      error: 'non_empty',
      message: 'lane has cards; move or delete them first',
      received: { path, laneId },
      next: 'move or delete all cards in this lane before deleting it',
    }, 409)
  }
  return c.json({ ok: true })
})

// POST /lanes/:id/move — reorder a lane relative to another
type MoveLaneBody = { path?: string[]; before?: string; after?: string }
app.post('/lanes/:id/move', async (c) => {
  const laneId = c.req.param('id')
  const body = await c.req.json<MoveLaneBody>().catch(() => ({} as MoveLaneBody))

  const parsedPath = parsePathFromBody(body.path)
  if ('invalid' in parsedPath) return c.json(INVALID_PATH_RESPONSE(parsedPath.invalid), 400)
  const path = parsedPath.path

  const before = typeof body.before === 'string' ? body.before : undefined
  const after = typeof body.after === 'string' ? body.after : undefined

  if (before === undefined && after === undefined) {
    return c.json({
      error: 'missing_position',
      received: body,
      expected: 'before or after laneId',
      next: 'send one of {"before": laneId} or {"after": laneId}',
    }, 400)
  }

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const ok = moveLane(doc, path, laneId, before ?? null, after ?? null)
    if (!ok) return { error: 'not_found' as const }
    return { lane: snapshotLane(doc, path, laneId) }
  })

  if ('error' in result) {
    return c.json({
      error: 'not_found',
      received: { path, laneId },
      next: 'list lanes with GET /api/board?path=...',
    }, 404)
  }
  return c.json(result)
})

// ---- snapshot helpers (read-after-write inside the same transaction) ----

// Navigate to a node by path without silently falling back to root on miss.
// Returns null if any segment is missing (unlike getNodeYMapByPath which
// silently returns root on miss — that behavior is safe for mutations that
// early-return when the target isn't found, but wrong for existence checks).
function getNodeByPath(root: Y.Map<unknown>, path: string[]): Y.Map<unknown> | null {
  let node = root
  for (let i = 1; i < path.length; i++) {
    const cards = node.get('cards')
    if (!(cards instanceof Y.Map)) return null
    const next = (cards as Y.Map<Y.Map<unknown>>).get(path[i])
    if (!(next instanceof Y.Map)) return null
    node = next
  }
  return node
}

function snapshotCard(doc: Y.Doc, path: string[], cardId: string) {
  const root = doc.getMap('root') as Y.Map<unknown>
  const parentNode = getNodeByPath(root, path)
  if (!parentNode) return null
  const cards = parentNode.get('cards')
  if (!(cards instanceof Y.Map)) return null
  const c = (cards as Y.Map<Y.Map<unknown>>).get(cardId)
  if (!(c instanceof Y.Map)) return null
  return {
    id: String(c.get('id')),
    text: String(c.get('title')),
    status: c.get('status') as CardStatus,
    laneId: String(c.get('laneId')),
    order: String(c.get('order')),
  }
}

function snapshotLane(doc: Y.Doc, path: string[], laneId: string): Pick<LaneJson, 'id' | 'name' | 'type'> | null {
  const root = doc.getMap('root') as Y.Map<unknown>
  const parentNode = getNodeByPath(root, path)
  if (!parentNode) return null
  const lanes = parentNode.get('lanes')
  if (!(lanes instanceof Y.Map)) return null
  const l = (lanes as Y.Map<Y.Map<unknown>>).get(laneId)
  if (!(l instanceof Y.Map)) return null
  return {
    id: String(l.get('id')),
    name: String(l.get('title')),
    type: l.get('type') as LaneType,
  }
}

export default app
