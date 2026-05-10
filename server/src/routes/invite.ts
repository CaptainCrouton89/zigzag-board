import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { auth } from '../auth.js'
import { db } from '../db/client.js'
import { orgInviteCode } from '../db/schema.js'
import { requireSession, type AuthVariables } from '../middleware/requireSession.js'

const app = new Hono<{ Variables: AuthVariables }>()
app.use('*', requireSession)

// R4.1 — accept invite code (idempotent for already-members)
app.post('/:code/accept', async (c) => {
  const code = c.req.param('code')
  const row = await db.select({ organizationId: orgInviteCode.organizationId })
    .from(orgInviteCode).where(eq(orgInviteCode.code, code)).limit(1)
  if (row.length === 0) return c.json({ error: 'invite not found' }, 404)
  const organizationId = row[0].organizationId

  try {
    // server-only invocation: addMember is registered without an HTTP path
    // (crud-members.mjs:24 — `createAuthEndpoint({...}, handler)` with no path
    // string), so it has no `/api/auth/organization/add-member` route and only
    // runs via this in-process API call. userId + organizationId are explicit
    // here; no headers/cookies needed because authz is structural (server-only).
    await auth.api.addMember({
      body: { userId: c.var.user.id, organizationId, role: 'member' },
    })
  } catch (err) {
    // Idempotent already-member path (crud-members.mjs:53). Pre-checking the
    // `member` table has a TOCTOU window under concurrent double-clicks;
    // catching the error is atomic and reuses better-auth's own check.
    const isAlreadyMember = err instanceof APIError
      && err.body?.code === 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION'
    if (!isAlreadyMember) throw err
  }

  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: c.req.raw.headers,
  })
  return c.json({ organizationId })
})

export default app
