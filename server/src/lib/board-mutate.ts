import * as Y from 'yjs'
import { hocuspocus } from '../sync/hocuspocus.js'

// Open a direct, in-process connection to the live Y.Doc for `orgId` and
// run a transaction against it. Hocuspocus's openDirectConnection runs the
// full document-load chain (Database extension hydrates from PG), surfaces
// the broadcast pipeline, and triggers debounced persistence on update —
// so the CLI's REST mutations behave exactly like a connected web client's
// edits, including live propagation to any open browser tabs.
//
// `unloadImmediately: true` is set in hocuspocus.ts:27 — after disconnect
// the document unloads and the next call cold-loads. Acceptable cost for
// CLI cadence; if it ever becomes a bottleneck, consider a short keep-alive.
export async function withBoardDoc<T>(
  orgId: string,
  fn: (doc: Y.Doc) => T,
): Promise<T> {
  const conn = await hocuspocus.openDirectConnection(orgId, {
    isAuthenticated: true,
    userId: 'cli',
    organizationId: orgId,
  })
  try {
    let result: T | undefined
    let captured = false
    await conn.transact((document) => {
      // Hocuspocus's Document extends Y.Doc, so the same Y.Map / Y.Array
      // operations the mutation helpers expect work directly here.
      result = fn(document as unknown as Y.Doc)
      captured = true
    })
    if (!captured) {
      // openDirectConnection.transact resolves only after the callback
      // completes, so this branch is theoretically unreachable. Guard
      // anyway so a future Hocuspocus refactor can't silently return
      // an undefined T.
      throw new Error('withBoardDoc: transaction did not run')
    }
    return result as T
  } finally {
    await conn.disconnect()
  }
}
