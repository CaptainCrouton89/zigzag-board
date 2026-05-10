export * from './auth-schema.js'

import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { organization } from './auth-schema.js'
import { bytea } from './bytea.js'

export const board = pgTable('board', {
  id: uuid('id').primaryKey().defaultRandom(),
  // FK type is `text` to match auth-schema's `organization.id`
  // (better-auth CLI emits text PKs).
  organizationId: text('organization_id')
    .references(() => organization.id, { onDelete: 'cascade' })
    .unique() // 1 board per org
    .notNull(),
  ydocState: bytea('ydoc_state'), // null until first store; binary Y.Doc snapshot
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const orgInviteCode = pgTable('org_invite_code', {
  // FK type is `text` to match auth-schema's `organization.id`.
  organizationId: text('organization_id')
    .primaryKey() // one code per org for v1
    .references(() => organization.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(), // nanoid(12)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
