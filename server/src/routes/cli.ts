import { Hono } from 'hono'
import { nanoid, customAlphabet } from 'nanoid'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { cliAuthRequest, cliSession, session } from '../db/schema.js'
import { requireSession, type AuthVariables } from '../middleware/requireSession.js'

// Module-scope: validate WEB_ORIGIN once at load. The CLI's verification
// URL points at the web app, not the API host. Explicit guard so a
// missing var fails with an actionable boot-time error instead of
// `new URL('')` throwing a confusing TypeError further along.
if (!process.env.WEB_ORIGIN) {
  throw new Error('WEB_ORIGIN required (set in /server/.env)')
}
const WEB_ORIGIN = new URL(process.env.WEB_ORIGIN).origin

// User-facing code: 4-4 grouping over an alphabet that omits visually
// confusable characters (0/O, 1/I/L). Two groups of 4 from 32 symbols ≈
// 40 bits of entropy. Codes live for 10 minutes; brute-forcing is not
// the threat model — accidental wrong-code approval is.
const userCodeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const genUserCodeHalf = customAlphabet(userCodeChars, 4)
function genUserCode() {
  return `${genUserCodeHalf()}-${genUserCodeHalf()}`
}

const DEVICE_CODE_TTL_SECONDS = 600 // 10 min — matches RFC 8628 default
const POLL_INTERVAL_SECONDS = 2
const SESSION_TTL_DAYS = 90

const app = new Hono<{ Variables: AuthVariables }>()

// ---- Unauthenticated: device-flow start ----
// Public on purpose. The deviceCode is unguessable (nanoid 32 chars ≈
// 190 bits); the userCode requires a logged-in human to approve. There is
// no DoS surface beyond inserting one row per call — TODO: add a per-IP
// rate limit if abuse appears.
app.post('/auth/start', async (c) => {
  const deviceCode = nanoid(32)
  const userCode = genUserCode()
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000)
  await db.insert(cliAuthRequest).values({
    deviceCode,
    userCode,
    status: 'pending',
    expiresAt,
  })
  return c.json({
    deviceCode,
    userCode,
    verificationUri: `${WEB_ORIGIN}/cli/authorize`,
    verificationUriComplete: `${WEB_ORIGIN}/cli/authorize?code=${userCode}`,
    expiresIn: DEVICE_CODE_TTL_SECONDS,
    interval: POLL_INTERVAL_SECONDS,
  })
})

// ---- Cookie-authed: web user approves the CLI device ----
// The CLI prints userCode; the user types/sees it in their browser and
// confirms. We insert a session row directly because better-auth 1.6.10
// has no public `createSession` primitive (only sign-in flows). The raw
// `token` value is what the bearer plugin will look up — see auth.ts:27
// (bearer() without requireSignature accepts raw tokens).
const approveApp = new Hono<{ Variables: AuthVariables }>()
approveApp.use('*', requireSession)

approveApp.post('/auth/approve', async (c) => {
  const body = await c.req.json<{ userCode?: string }>().catch(() => ({} as { userCode?: string }))
  const userCode = typeof body.userCode === 'string' ? body.userCode.trim().toUpperCase() : ''
  if (!userCode) return c.json({ error: 'userCode required' }, 400)

  const rows = await db
    .select({
      deviceCode: cliAuthRequest.deviceCode,
      status: cliAuthRequest.status,
      expiresAt: cliAuthRequest.expiresAt,
    })
    .from(cliAuthRequest)
    .where(eq(cliAuthRequest.userCode, userCode))
    .limit(1)
  if (rows.length === 0) return c.json({ error: 'unknown_code' }, 404)
  const row = rows[0]
  if (row.expiresAt < new Date()) return c.json({ error: 'expired' }, 410)
  if (row.status !== 'pending') return c.json({ error: 'already_used' }, 409)

  // Hand-built session row. Fields mirror auth-schema.ts:28-46.
  // - `id` and `token` are independent random values; only `token` is
  //   sent to the CLI / used as the bearer credential.
  // - `updatedAt` has no DB default (only $onUpdate, which fires on
  //   UPDATE not INSERT) so we must provide it explicitly.
  // - `activeOrganizationId` is intentionally null — the CLI sends
  //   X-Org-Id per request rather than relying on session-bound state.
  const sessionId = nanoid(24)
  const tokenValue = nanoid(32)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  await db.insert(session).values({
    id: sessionId,
    token: tokenValue,
    userId: c.var.user.id,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(cliSession).values({ sessionId, label: 'zigzag CLI' })

  await db
    .update(cliAuthRequest)
    .set({
      status: 'approved',
      userId: c.var.user.id,
      sessionToken: tokenValue,
    })
    .where(eq(cliAuthRequest.deviceCode, row.deviceCode))

  return c.json({ ok: true })
})

approveApp.post('/auth/deny', async (c) => {
  const body = await c.req.json<{ userCode?: string }>().catch(() => ({} as { userCode?: string }))
  const userCode = typeof body.userCode === 'string' ? body.userCode.trim().toUpperCase() : ''
  if (!userCode) return c.json({ error: 'userCode required' }, 400)
  await db
    .update(cliAuthRequest)
    .set({ status: 'denied' })
    .where(and(eq(cliAuthRequest.userCode, userCode), eq(cliAuthRequest.status, 'pending')))
  return c.json({ ok: true })
})

// ---- Unauthenticated: CLI poll ----
// Atomic claim via SELECT ... FOR UPDATE inside a transaction. Once the
// token has been read out, the column is nulled in the same transaction
// so a second poll cannot retrieve the same value (e.g. if the CLI
// retried on a flaky connection after the response was already in flight).
app.post('/auth/poll', async (c) => {
  const body = await c.req.json<{ deviceCode?: string }>().catch(() => ({} as { deviceCode?: string }))
  const deviceCode = typeof body.deviceCode === 'string' ? body.deviceCode : ''
  if (!deviceCode) return c.json({ error: 'deviceCode required' }, 400)

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        status: cliAuthRequest.status,
        userId: cliAuthRequest.userId,
        sessionToken: cliAuthRequest.sessionToken,
        expiresAt: cliAuthRequest.expiresAt,
      })
      .from(cliAuthRequest)
      .where(eq(cliAuthRequest.deviceCode, deviceCode))
      .for('update')
      .limit(1)
    if (rows.length === 0) return { status: 'expired' as const }
    const row = rows[0]
    if (row.status === 'denied') return { status: 'denied' as const }
    if (row.expiresAt < new Date()) return { status: 'expired' as const }
    if (row.status === 'approved' && row.sessionToken) {
      await tx
        .update(cliAuthRequest)
        .set({ sessionToken: null })
        .where(eq(cliAuthRequest.deviceCode, deviceCode))
      return {
        status: 'approved' as const,
        token: row.sessionToken,
        userId: row.userId!,
      }
    }
    if (row.status === 'approved') {
      // Approved but token already claimed by a prior poll — treat as
      // expired so the CLI cannot keep polling indefinitely.
      return { status: 'expired' as const }
    }
    return { status: 'pending' as const }
  })

  return c.json(result)
})

// ---- Bearer-authed: CLI revoke (logout) ----
// Deletes the session row that backs this bearer token; cliSession
// row drops via cascade. After this, the same token returns 401.
const revokeApp = new Hono<{ Variables: AuthVariables }>()
revokeApp.use('*', requireSession)

revokeApp.post('/auth/revoke', async (c) => {
  await db.delete(session).where(eq(session.id, c.var.session.id))
  return c.json({ ok: true })
})

// ---- Garbage collection helper (callable internally; not exposed) ----
// Sweep rows older than TTL. Not wired to a cron in this PR — invoke
// manually or add a periodic task if the table grows.
export async function sweepExpiredCliAuthRequests() {
  await db
    .delete(cliAuthRequest)
    .where(and(isNull(cliAuthRequest.sessionToken), eq(cliAuthRequest.status, 'expired')))
}

app.route('/', approveApp)
app.route('/', revokeApp)

export default app
