import { customType } from 'drizzle-orm/pg-core'

// drizzle-orm 0.45.x stable does NOT export `bytea` from pg-core
// (it landed in 1.0.0-rc.x). `customType` is the documented Drizzle
// pattern for unsupported Postgres types.
//
// node-postgres returns BYTEA columns as Node `Buffer`; Buffer extends
// Uint8Array, which is exactly what Yjs's `applyUpdate(doc, update)` and
// `Y.encodeStateAsUpdate(doc)` consume/produce — so no extra coercion is
// needed at the @hocuspocus/extension-database persistence boundary.
//
// drizzle-kit picks up the SQL type from `dataType()` and emits `bytea`
// in generated migrations.
export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea'
  },
})
