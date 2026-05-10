import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization, bearer } from 'better-auth/plugins'
import { db } from './db/client.js'
import * as schema from './db/schema.js'

// Defensive guard: ESM imports evaluate before importer bodies, so the env-guard
// in index.ts:5–10 has not run yet when this module loads. Catch the missing-var
// case here so betterAuth's eager validation doesn't throw a confusing stack first.
if (!process.env.WEB_ORIGIN) {
  throw new Error('WEB_ORIGIN required (set in /server/.env)')
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true },             // R2.5 — no email verification
  trustedOrigins: [process.env.WEB_ORIGIN],        // R2.4 — must equal CORS allowlist
  advanced: {
    useSecureCookies: true,                        // unconditional; Chrome/Firefox
                                                   // accept Secure on localhost
    defaultCookieAttributes: {
      sameSite: 'none',                            // R2.3 — cross-origin cookies
      secure: true,
      partitioned: true,
    },
  },
  plugins: [organization(), bearer()],             // path B fallback (cookie path A is primary in v1)
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
})
