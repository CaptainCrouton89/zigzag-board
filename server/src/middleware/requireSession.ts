import type { MiddlewareHandler } from 'hono'
import { auth } from '../auth.js'

// Derive the variable types from better-auth's actual session shape so route handlers
// see every field better-auth populates (name, emailVerified, activeOrganizationId, …)
// without having to re-narrow. Cheaper than maintaining a parallel interface.
type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
export type AuthVariables = {
  user: AuthSession['user']
  session: AuthSession['session']
}

export const requireSession: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!s) return c.body(null, 401)
  c.set('user', s.user)
  c.set('session', s.session)
  await next()
}
