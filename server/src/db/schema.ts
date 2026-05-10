export * from './auth-schema.js'

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { organization, session, user } from './auth-schema.js'
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

// CLI device-flow auth request. The CLI gets `deviceCode` (opaque, never
// shown to a human) and prints `userCode` for the user to confirm in the
// browser. After the user approves, the row is updated with userId and
// sessionToken; the CLI's poll atomically claims the token by nulling the
// column in the same UPDATE so a double-poll cannot leak it.
export const cliAuthRequest = pgTable(
  'cli_auth_request',
  {
    deviceCode: text('device_code').primaryKey(),
    userCode: text('user_code').notNull().unique(),
    status: text('status').notNull(), // 'pending' | 'approved' | 'denied' | 'expired'
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token'), // nulled atomically on first successful poll
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('cli_auth_request_user_code_idx').on(t.userCode)],
)

// Sidecar metadata so a future "Devices" UI can list / revoke CLI sessions
// without pulling in non-CLI sessions. session row is the source of truth;
// this row is deleted on revoke via cascade.
export const cliSession = pgTable('cli_session', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => session.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
