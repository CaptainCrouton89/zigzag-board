import { readCredentials, clearCredentials } from '../../config.js'
import { apiRequest } from '../../api.js'

export async function authLogoutCommand(): Promise<void> {
  const creds = await readCredentials()
  if (creds !== null) {
    // Best-effort revoke — delete local credentials regardless of server result.
    await apiRequest(creds, '/api/cli/auth/revoke', {
      method: 'POST',
      attachOrg: false,
    }).catch((err: unknown) => {
      process.stderr.write(`warning: server revoke failed: ${(err as Error).message}\n`)
    })
    await clearCredentials()
  }
  process.stdout.write(JSON.stringify({ ok: true }) + '\n')
}
