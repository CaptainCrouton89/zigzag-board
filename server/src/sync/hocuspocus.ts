import { Hocuspocus } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { eq, and } from 'drizzle-orm'
import * as Y from 'yjs'
import { auth } from '../auth.js'
import { db } from '../db/client.js'
import { board, member } from '../db/schema.js'

// Module-scope: validate WEB_ORIGIN once at load. URL constructor throws on
// missing/malformed input → boot-time misconfig surfacing. Mirrors
// `routes/org.ts:15` (Phase-3 baseline) so misconfig fails identically across
// HTTP and WS surfaces. Phase-1 `index.ts` env-guard catches *missing*
// WEB_ORIGIN; this also catches *malformed* (e.g. `localhost:3000` without
// scheme).
if (!process.env.WEB_ORIGIN) throw new Error('WEB_ORIGIN required')
const WEB_ORIGIN = new URL(process.env.WEB_ORIGIN).origin

// Deterministic seed lane id — see master plan R-WS-5. Concurrent seeds from
// multiple replicas write to the same Y.Map key, so CRDT LWW collapses them
// to one lane rather than producing duplicates with random ids.
const SEED_LANE_ID = 'lane-default'

export const hocuspocus = new Hocuspocus({
  name: 'zigzagboard',
  debounce: 2000,        // R5.6
  maxDebounce: 10000,    // R5.6
  unloadImmediately: true, // R5.6 / R5.7 — flush pending store on last-client disconnect
  yDocOptions: { gc: true, gcFilter: () => true },

  // R5.2 / R5.3 / R5.4 — cookie path A. Browser WebSocket cannot set custom
  // headers, but it DOES send cookies on cross-origin WS upgrade subject to
  // SameSite (we set None; Secure; Partitioned in auth.ts). bearer plugin is
  // wired in auth.ts as a future path-B fallback but not exercised here.
  async onAuthenticate({ documentName, requestHeaders, request }) {
    // R10.2 — CSWSH defense. Strict equality, no wildcards.
    const rawOrigin = request.headers.get('origin')
    const origin = rawOrigin !== null ? rawOrigin : ''
    if (origin !== WEB_ORIGIN) throw new Error('forbidden origin')

    // R5.3 — `requestHeaders` is web-standard Headers in Hocuspocus v4
    // (verified at node_modules/@hocuspocus/server/dist/index.d.ts:446).
    // better-auth's getSession accepts Headers directly.
    const s = await auth.api.getSession({ headers: requestHeaders })
    if (!s) throw new Error('unauthenticated')

    // R5.4 — membership vs documentName, NOT activeOrganizationId. A user
    // may be a member of multiple orgs; let them open any of their boards.
    // Active-org is a UI preference, not an authorization boundary.
    const m = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, s.user.id), eq(member.organizationId, documentName)))
      .limit(1)
    if (m.length === 0) throw new Error('not a member')

    return { userId: s.user.id, organizationId: documentName }
  },

  // R6.9 — server-side default-lane seed. Runs after the Database extension's
  // own onLoadDocument has applied fetched bytes (or no-op if null).
  // Idempotent: existing-lanes case short-circuits. Multi-replica race is
  // neutralized by the deterministic SEED_LANE_ID — concurrent writes converge
  // via Y.Map LWW on the same key. See master plan R-WS-5.
  async onLoadDocument({ document }) {
    const root = document.getMap('root') as Y.Map<unknown>
    const existing = root.get('lanes')
    if (existing instanceof Y.Map && existing.size > 0) return null

    document.transact(() => {
      let lanes = root.get('lanes')
      if (!(lanes instanceof Y.Map)) {
        lanes = new Y.Map<unknown>()
        root.set('lanes', lanes)
      }
      const lane = new Y.Map<unknown>()
      lane.set('id', SEED_LANE_ID)
      lane.set('title', 'Next steps')
      lane.set('type', 'saga')
      lane.set('order', 'a0')
      ;(lanes as Y.Map<Y.Map<unknown>>).set(SEED_LANE_ID, lane)
    }, 'server:seed')

    return null
  },

  extensions: [
    new Database({
      // R5.5.1 — null when no row. node-pg returns BYTEA as Buffer; Buffer
      // extends Uint8Array, which is exactly what Y.applyUpdate consumes.
      // No coercion needed (see bytea.ts:7-10).
      fetch: async ({ documentName }) => {
        const row = await db
          .select({ ydocState: board.ydocState })
          .from(board)
          .where(eq(board.organizationId, documentName))
          .limit(1)
        return row[0]?.ydocState ?? null
      },
      // R5.5.2 — full Y.encodeStateAsUpdate(document) snapshot per call (NOT
      // a delta). board.organization_id has .unique() (Phase-1 schema) →
      // onConflictDoUpdate is atomic upsert.
      store: async ({ documentName, state }) => {
        const now = new Date()
        await db
          .insert(board)
          .values({ organizationId: documentName, ydocState: state, updatedAt: now })
          .onConflictDoUpdate({
            target: board.organizationId,
            set: { ydocState: state, updatedAt: now },
          })
      },
    }),
  ],
})
