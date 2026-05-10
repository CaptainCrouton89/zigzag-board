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
  readBoard,
  type LaneJson,
} from '../lib/board/mutations.js'
import type { LaneType, CardStatus } from '../lib/board/types.js'

// Path for the top-level board. Zoom-in is a web-only UI concept; CLI
// operations target the root card. If we ever need to expose nested
// boards via CLI, this becomes a per-request parameter.
const ROOT_PATH = ['root']

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

// ---- READ ----
app.get('/', async (c) => {
  const data = await withBoardDoc(c.var.orgId, (doc) => readBoard(doc))
  return c.json({ orgId: c.var.orgId, ...data })
})

// ---- CARDS ----
type AddCardBody = { laneId?: string; text?: string; before?: string; after?: string }
app.post('/cards', async (c) => {
  const body = await c.req.json<AddCardBody>().catch(() => ({} as AddCardBody))
  const laneId = typeof body.laneId === 'string' ? body.laneId : ''
  const text = typeof body.text === 'string' ? body.text : ''
  if (!laneId) return c.json({ error: 'laneId required' }, 400)
  if (!text.trim()) return c.json({ error: 'text required' }, 400)
  const before = typeof body.before === 'string' ? body.before : null
  const after = typeof body.after === 'string' ? body.after : null

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    // Confirm lane exists before insert so we can return 404 instead of a
    // silent no-op (addCardAt early-returns on missing lane).
    const root = doc.getMap('root') as Y.Map<unknown>
    const lanes = root.get('lanes')
    if (!(lanes instanceof Y.Map)) return { error: 'lane_not_found' as const }
    if (!(lanes as Y.Map<Y.Map<unknown>>).get(laneId)) return { error: 'lane_not_found' as const }
    const id = addCardAt(doc, ROOT_PATH, laneId, text, before, after)
    return { card: snapshotCard(doc, id) }
  })
  if ('error' in result) return c.json({ error: result.error }, 404)
  return c.json(result, 201)
})

type PatchCardBody = { text?: string; laneId?: string; before?: string; after?: string }
app.patch('/cards/:id', async (c) => {
  const cardId = c.req.param('id')
  const body = await c.req.json<PatchCardBody>().catch(() => ({} as PatchCardBody))
  const text = typeof body.text === 'string' ? body.text : null
  const laneId = typeof body.laneId === 'string' ? body.laneId : null
  const before = typeof body.before === 'string' ? body.before : null
  const after = typeof body.after === 'string' ? body.after : null
  const wantsMove = laneId !== null || before !== null || after !== null

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const root = doc.getMap('root') as Y.Map<unknown>
    const cards = root.get('cards')
    if (!(cards instanceof Y.Map)) return { error: 'not_found' as const }
    if (!(cards as Y.Map<Y.Map<unknown>>).get(cardId)) return { error: 'not_found' as const }

    if (text !== null) {
      if (!text.trim()) return { error: 'text_empty' as const }
      setCardTitle(doc, ROOT_PATH, cardId, text)
    }
    if (wantsMove) {
      const ok = moveCardTo(doc, ROOT_PATH, cardId, laneId, before, after)
      if (!ok) return { error: 'move_failed' as const }
    }
    return { card: snapshotCard(doc, cardId) }
  })
  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 400
    return c.json({ error: result.error }, status)
  }
  return c.json(result)
})

app.delete('/cards/:id', async (c) => {
  const cardId = c.req.param('id')
  const result = await withBoardDoc(c.var.orgId, (doc) => {
    return removeCard(doc, ROOT_PATH, cardId)
  })
  if (!result) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

// ---- LANES ----
type AddLaneBody = { name?: string; type?: LaneType }
app.post('/lanes', async (c) => {
  const body = await c.req.json<AddLaneBody>().catch(() => ({} as AddLaneBody))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return c.json({ error: 'name required' }, 400)
  const type: LaneType = body.type === 'backlog' ? 'backlog' : 'saga'

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const id = addLaneAt(doc, ROOT_PATH, name, type)
    return { lane: snapshotLane(doc, id) }
  })
  return c.json(result, 201)
})

type PatchLaneBody = { name?: string; type?: LaneType }
app.patch('/lanes/:id', async (c) => {
  const laneId = c.req.param('id')
  const body = await c.req.json<PatchLaneBody>().catch(() => ({} as PatchLaneBody))
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const type = body.type === 'saga' || body.type === 'backlog' ? body.type : null
  if (name === null && type === null) return c.json({ error: 'no_changes' }, 400)

  const result = await withBoardDoc(c.var.orgId, (doc) => {
    const root = doc.getMap('root') as Y.Map<unknown>
    const lanes = root.get('lanes')
    if (!(lanes instanceof Y.Map)) return { error: 'not_found' as const }
    if (!(lanes as Y.Map<Y.Map<unknown>>).get(laneId)) return { error: 'not_found' as const }

    if (name !== null) {
      if (!name) return { error: 'name_empty' as const }
      setLaneTitle(doc, ROOT_PATH, laneId, name)
    }
    if (type !== null) {
      setLaneType(doc, ROOT_PATH, laneId, type)
    }
    return { lane: snapshotLane(doc, laneId) }
  })
  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 400
    return c.json({ error: result.error }, status)
  }
  return c.json(result)
})

app.delete('/lanes/:id', async (c) => {
  const laneId = c.req.param('id')
  const outcome = await withBoardDoc(c.var.orgId, (doc) => {
    return removeLane(doc, ROOT_PATH, laneId)
  })
  if (outcome === 'not_found') return c.json({ error: 'not_found' }, 404)
  if (outcome === 'non_empty') {
    return c.json(
      { error: 'non_empty', message: 'lane has cards; move or delete them first' },
      409,
    )
  }
  return c.json({ ok: true })
})

// ---- snapshot helpers (read-after-write inside the same transaction) ----
function snapshotCard(doc: Y.Doc, cardId: string) {
  const root = doc.getMap('root') as Y.Map<unknown>
  const cards = root.get('cards')
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

function snapshotLane(doc: Y.Doc, laneId: string): Pick<LaneJson, 'id' | 'name' | 'type'> | null {
  const root = doc.getMap('root') as Y.Map<unknown>
  const lanes = root.get('lanes')
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
