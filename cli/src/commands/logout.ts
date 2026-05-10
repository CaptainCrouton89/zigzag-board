import { readCredentials, clearCredentials } from '../config.js'
import { apiRequest } from '../api.js'

export async function logoutCommand(): Promise<void> {
  const creds = await readCredentials()
  if (creds === null) {
    process.stdout.write('Already logged out.\n')
    return
  }
  // Best-effort revoke: delete the local credentials regardless of server
  // result so the user is never stuck with stale local state if the
  // server is unreachable. We still call revoke first so a successful
  // server delete is the common path; failure logs a warning, no throw.
  await apiRequest(creds, '/api/cli/auth/revoke', {
    method: 'POST',
    attachOrg: false,
  }).catch((err: unknown) => {
    process.stderr.write(`warning: server revoke failed: ${(err as Error).message}\n`)
  })
  await clearCredentials()
  process.stdout.write('Logged out.\n')
}
