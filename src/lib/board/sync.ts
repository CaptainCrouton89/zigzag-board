import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

// Refcounted entry: one Y.Doc + provider per orgId, shared across all
// `useBoard(orgId)` callers in the same browser tab. Refcount-based teardown
// keeps React-19 strict-mode double-mount (mount → unmount → mount in dev)
// from churning a real WebSocket connection.
type Entry = { ydoc: Y.Doc; provider: HocuspocusProvider; refcount: number }

const cache = new Map<string, Entry>()

export function getProvider(orgId: string): {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  release: () => void
} {
  // Validated lazily (not at module load) — Next builds the page bundle on
  // the server where NEXT_PUBLIC_SYNC_URL is inlined at build time, but a
  // missing var should surface as a clear runtime error on first use rather
  // than a cryptic module-load crash during SSR rendering.
  const url = process.env.NEXT_PUBLIC_SYNC_URL
  if (!url) throw new Error('NEXT_PUBLIC_SYNC_URL is not set')

  const existing = cache.get(orgId)
  if (existing) {
    existing.refcount += 1
    return wrap(orgId, existing)
  }

  const ydoc = new Y.Doc()
  const provider = new HocuspocusProvider({
    url,                  // wss://api.../sync (or ws://localhost:8787/sync in dev)
    name: orgId,          // documentName — server validates membership against this
    document: ydoc,
    // Cookie path A (design.md §4.2): the better-auth session cookie is
    // attached automatically by the browser on the cross-origin WS upgrade,
    // gated by SameSite=None; Secure (set in server/src/auth.ts). The
    // browser WebSocket API cannot inject custom headers, so `token` is
    // unused here — kept as the explicit "path A" marker. Bearer plugin is
    // wired server-side as a future fallback (path B) but not exercised.
    token: '',
    // R5.8 — no presence cursors in v1. Disabling awareness skips the
    // periodic ping; Hocuspocus's reconnect loop still fires on raw socket
    // close, and Yjs queues outbound updates inside ydoc until reconnect.
    awareness: null,
  })

  const entry: Entry = { ydoc, provider, refcount: 1 }
  cache.set(orgId, entry)
  return wrap(orgId, entry)
}

function wrap(orgId: string, entry: Entry) {
  let released = false
  return {
    ydoc: entry.ydoc,
    provider: entry.provider,
    release() {
      if (released) return  // idempotent: guards strict-mode double-cleanup
      released = true
      entry.refcount -= 1
      if (entry.refcount > 0) return
      // React-19 strict-mode dev double-mount fires cleanup → effect again
      // synchronously in the same tick; deferring the teardown via
      // queueMicrotask lets the second mount's `getProvider` re-bump
      // refcount before destroy runs. Production has no double-mount, so
      // the microtask is harmless (one tick later teardown).
      queueMicrotask(() => {
        if (entry.refcount > 0) return  // re-mount happened → keep alive
        cache.delete(orgId)
        // Order matters: disconnect closes the WS; destroy tears down the
        // provider's internal listeners; ydoc.destroy frees CRDT structures.
        entry.provider.disconnect()
        entry.provider.destroy()
        entry.ydoc.destroy()
      })
    },
  }
}
