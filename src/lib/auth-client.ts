import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'

// NEXT_PUBLIC_API_URL is build-time inlined by Next, so a missing value here
// is a build-config bug — fail loudly at module load. This is the OPPOSITE
// policy of `src/lib/board/sync.ts:17-22` (lazy validation) because:
//   - `auth-client.ts` is imported by every auth-touching page at module load
//     (login, signup, onboarding, BoardClient header chip), so a missing var
//     surfaces immediately on first navigation regardless;
//   - `sync.ts` is only imported when a board is opened post-auth, where a
//     deferred error message is more useful than a module-load crash during
//     SSR rendering of the gate.
// If you need to import this module from a server component, DON'T —
// `better-auth/react` is a client-only surface (uses `window` lazily inside
// `useSession`). Phase 6 deliberately has NO server-side session reads:
// the root gate, /invite/[code], and BoardClient header chip all read the
// session from this hookified client in the browser. Cross-origin XHR with
// credentials:'include' carries the Partitioned cookie that a Vercel
// server-component cookies() call cannot see (host-only on Railway).
const baseURL = process.env.NEXT_PUBLIC_API_URL
if (!baseURL) {
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

export const authClient = createAuthClient({
  baseURL,
  // R2.4 + R10.3 — cross-origin cookie carriage. CORS on the server is
  // configured with `credentials: true`, the cookie is set with
  // `SameSite=None; Secure; Partitioned`, and this fetch option closes the
  // loop by telling the browser to actually send/store cookies on
  // cross-origin requests to the API.
  fetchOptions: {
    credentials: 'include',
  },
  // R8.10 defers the org switcher to Phase 7, but wiring the org client
  // plugin now means Phase 7 needs zero edits to this module — the typed
  // organization actions (`authClient.organization.list`, `.setActive`,
  // etc.) are immediately available when that slice lands.
  plugins: [organizationClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
