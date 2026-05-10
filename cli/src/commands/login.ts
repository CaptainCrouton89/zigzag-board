import open from 'open'
import { defaultApiUrl, writeCredentials, credentialsFilePath, type Credentials } from '../config.js'
import { apiRequest, credsForApi } from '../api.js'
import { CLIError } from '../errors.js'

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

export async function loginCommand(): Promise<void> {
  const apiUrl = defaultApiUrl()
  const ephemeral = credsForApi(apiUrl)

  // Step 1: ask the server for a device + user code pair.
  const start = await apiRequest<DeviceFlowStart>(ephemeral, '/api/cli/auth/start', {
    method: 'POST',
    authenticated: false,
    attachOrg: false,
  })

  process.stdout.write(`\nOpening ${start.verificationUri} in your browser…\n`)
  process.stdout.write(`Verification code: ${start.userCode}\n`)
  process.stdout.write(`If the browser does not open, visit:\n  ${start.verificationUriComplete}\n\n`)

  // Best-effort: if open fails (headless environment, no GUI browser), we
  // continue anyway since the user can paste the URL manually.
  await open(start.verificationUriComplete).catch(() => {
    process.stdout.write('(could not open a browser automatically)\n')
  })

  // Step 2: poll until approved or timeout.
  const intervalMs = Math.max(1, start.interval) * 1000
  const deadline = Date.now() + start.expiresIn * 1000
  process.stdout.write('Waiting for approval')
  let token: string | null = null
  let userId: string | null = null
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    process.stdout.write('.')
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
      process.stdout.write('\n')
      throw new CLIError('auth', 'authorization was denied in the browser')
    }
    if (result.status === 'expired') {
      process.stdout.write('\n')
      throw new CLIError(
        'auth',
        'authorization request expired',
        'run `zigzag login` again',
      )
    }
  }
  process.stdout.write('\n')
  if (token === null || userId === null) {
    throw new CLIError(
      'auth',
      'authorization timed out',
      'run `zigzag login` again',
    )
  }

  // Step 3: persist credentials, then resolve the active org. Fetching
  // /api/org/me with the new token serves three purposes: (a) sanity-check
  // the token works end-to-end before we report success, (b) seed the
  // credentials file with the user's email + a sensible default active
  // org, (c) print a friendly confirmation.
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

  await writeCredentials({
    apiUrl,
    token,
    userId,
    email,
    activeOrgId: initialOrg,
  })

  const activeOrg = me.orgs.find((o) => o.id === initialOrg)
  process.stdout.write(`Logged in${typeof email === 'string' ? ` as ${email}` : ''}.\n`)
  if (activeOrg !== undefined) {
    process.stdout.write(`Active org: ${activeOrg.name} (${activeOrg.slug})\n`)
  } else if (me.orgs.length === 0) {
    process.stdout.write('You are not a member of any organization yet.\n')
    process.stdout.write('Create or join one in the web app, then run `zigzag org list`.\n')
  } else {
    process.stdout.write('Multiple orgs found — run `zigzag org list` and `zigzag org use <id>`.\n')
  }
  process.stdout.write(`Token saved to ${credentialsFilePath()}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
