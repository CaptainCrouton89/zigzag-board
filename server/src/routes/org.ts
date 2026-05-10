import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { auth } from '../auth.js'
import { db } from '../db/client.js'
import { board, orgInviteCode, member, organization } from '../db/schema.js'
import { requireSession, type AuthVariables } from '../middleware/requireSession.js'

// Module-scope: validate WEB_ORIGIN once at module load. `new URL(...)` throws
// TypeError on invalid input (missing scheme, undefined, etc.), surfacing the
// misconfig at boot rather than as `"undefined/invite/<code>"` per request.
// Phase-1 startup guard (`index.ts:6-11`) already exits if WEB_ORIGIN is unset;
// this catches malformed values too.
const WEB_ORIGIN = new URL(process.env.WEB_ORIGIN ?? '').origin

const app = new Hono<{ Variables: AuthVariables }>()
app.use('*', requireSession)

// R3.1 — create org + board + invite code; return invite URL
app.post('/', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  // Reject whitespace-only / special-char-only / oversize names. The bare
  // `if (!name)` predecessor accepted "  ", "🦆", "---" — all of which slugify
  // to "" and produce a leading-dash slug like "-aB3xY7". Trim once, validate
  // and slugify from the same trimmed value so they cannot disagree.
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed || trimmed.length > 100) {
    return c.json({ error: 'name required (1–100 chars)' }, 400)
  }

  // better-auth's createOrganization auto-calls setActiveOrganization on the current
  // session (verified in crud-org.mjs:142). slug must be unique on `organization`
  // (auth-schema.ts:98 uniqueIndex). Append nanoid(6) to make collisions astronomical.
  // Fall back to 'org' if the slugified base is empty (e.g. trimmed="🦆") so the
  // final slug is never just "-XXXXXX".
  const baseSlug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const slug = `${baseSlug || 'org'}-${nanoid(6)}`
  const org = await auth.api.createOrganization({
    body: { name: trimmed, slug },
    headers: c.req.raw.headers,
  })

  // Best-effort: better-auth has no transactional handle, so atomicity across
  // createOrganization + Drizzle inserts is impossible. On insert failure we
  // compensate by deleting the just-created org. See master Risk R-A.
  const code = nanoid(12)
  try {
    // Both inserts only depend on `org.id` (and `code` for the second), not on
    // each other's results. Parallelizing saves one DB round-trip on the
    // org-creation cold path. Compensation below is symmetric — either insert
    // failing triggers the same deleteOrganization rollback, so Promise.all's
    // fail-fast semantics don't change rollback shape.
    await Promise.all([
      db.insert(board).values({ organizationId: org.id }),
      db.insert(orgInviteCode).values({ organizationId: org.id, code }),
    ])
  } catch (err) {
    await auth.api.deleteOrganization({
      body: { organizationId: org.id },
      headers: c.req.raw.headers,
    }).catch((compErr) => {
      // Surface compensation failure separately from the original error so an
      // orphan org leak is observable. Original `err` is logged + rethrown
      // below — do not shadow it. Phase-7 sweep handles cleanup.
      console.error('[POST /api/org] compensation deleteOrganization failed', compErr)
    })
    console.error('[POST /api/org] post-create insert failed; rolled back org', err)
    throw err
  }

  // Redundant per crud-org.mjs:142 (already set during createOrganization), but
  // matches design.md §7 verbatim and is idempotent. Keep for explicit defense.
  await auth.api.setActiveOrganization({
    body: { organizationId: org.id },
    headers: c.req.raw.headers,
  })

  return c.json(
    { organizationId: org.id, inviteUrl: `${WEB_ORIGIN}/invite/${code}` },
    201,
  )
})

// R3.2 — list memberships + active org. Use a direct Drizzle join because
// `auth.api.listOrganizations` discards `member.role` (adapter.mjs:345-356
// maps each row to `member.organization`, dropping the `role` field). Phase-6
// frontend needs `role` per item to gate owner-only UI. Single query, no N+1.
app.get('/me', async (c) => {
  const orgs = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, c.var.user.id))
  return c.json({
    orgs,
    activeOrganizationId: c.var.session.activeOrganizationId,
  })
})

// R3.3 — set active org; non-member → 403
app.post('/:id/select', async (c) => {
  const id = c.req.param('id')
  try {
    await auth.api.setActiveOrganization({
      body: { organizationId: id },
      headers: c.req.raw.headers,
    })
    return c.body(null, 204)
  } catch (err) {
    // crud-org.mjs:387 throws APIError("FORBIDDEN", "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION")
    // Standardize on JSON error body across all non-204 responses so Phase-6
    // frontend can do `if (!res.ok) { const {error} = await res.json() }`
    // uniformly.
    if (err instanceof APIError && err.status === 'FORBIDDEN') {
      return c.json({ error: 'not a member' }, 403)
    }
    throw err
  }
})

export default app
