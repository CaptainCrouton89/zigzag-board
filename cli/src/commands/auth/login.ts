import open from 'open'
import { defaultApiUrl, writeCredentials, credentialsFilePath, type Credentials } from '../../config.js'
import { apiRequest, credsForApi } from '../../api.js'
import { CLIError } from '../../errors.js'

interface DeviceFlowStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

type PollResult =
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; userId: string }

interface OrgMembership { id: string; name: string; slug: string }

export async function authLoginCommand(): Promise<void> {
  const apiUrl = defaultApiUrl()
  const ephemeral = credsForApi(apiUrl)

  const start = await apiRequest<DeviceFlowStart>(ephemeral, '/api/cli/auth/start', {
    method: 'POST',
    authenticated: false,
    attachOrg: false,
  })

  // Diagnostic chatter to stderr — not part of the JSON contract.
  process.stderr.write(`Opening ${start.verificationUri} in your browser…\n`)
  process.stderr.write(`Verification code: ${start.userCode}\n`)
  process.stderr.write(`If the browser does not open, visit:\n  ${start.verificationUriComplete}\n`)

  await open(start.verificationUriComplete).catch(() => {
    process.stderr.write('(could not open a browser automatically)\n')
  })

  const intervalMs = Math.max(1, start.interval) * 1000
  const deadline = Date.now() + start.expiresIn * 1000
  process.stderr.write('Waiting for approval')

  let token: string | null = null
  let userId: string | null = null

  while (Date.now() < deadline) {
    await sleep(intervalMs)
    process.stderr.write('.')
    const result = await apiRequest<PollResult>(ephemeral, '/api/cli/auth/poll', {
      method: 'POST',
      authenticated: false,
      attachOrg: false,
      body: { deviceCode: start.deviceCode },
    })
    if (result.status === 'approved') {
      token = result.token
      userId = result.userId
      break
    }
    if (result.status === 'denied') {
      process.stderr.write('\n')
      throw new CLIError({ error: 'auth_denied', message: 'authorization was denied in the browser' })
    }
    if (result.status === 'expired') {
      process.stderr.write('\n')
      throw new CLIError({ error: 'auth_expired', message: 'authorization request expired', next: 'run `zigzag auth login` again' })
    }
  }

  process.stderr.write('\n')
  if (token === null || userId === null) {
    throw new CLIError({ error: 'auth_timeout', message: 'authorization timed out', next: 'run `zigzag auth login` again' })
  }

  const partial: Credentials = { apiUrl, token, userId }
  const me = await apiRequest<{
    orgs: OrgMembership[]
    activeOrganizationId: string | null
    user?: { email?: string }
  }>(partial, '/api/org/me', { attachOrg: false })

  const initialOrg = me.activeOrganizationId !== null && me.activeOrganizationId.length > 0
    ? me.activeOrganizationId
    : (me.orgs.length === 1 ? me.orgs[0].id : null)
  const email = me.user !== undefined && typeof me.user.email === 'string' ? me.user.email : undefined

  await writeCredentials({ apiUrl, token, userId, email, activeOrgId: initialOrg })

  process.stdout.write(JSON.stringify({
    userId,
    email: email ?? null,
    activeOrgId: initialOrg,
    apiUrl,
  }) + '\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
