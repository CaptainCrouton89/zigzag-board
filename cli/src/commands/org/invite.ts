import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'
import { CLIError } from '../../errors.js'

interface InviteResponse { inviteUrl: string }

function requireActiveOrg(activeOrgId: string | null | undefined): string {
  if (typeof activeOrgId !== 'string' || activeOrgId.length === 0) {
    throw new CLIError({
      error: 'no_active_org',
      message: 'no active organization',
      next: 'run `zigzag org use <id|slug>` to set one',
    })
  }
  return activeOrgId
}

export async function orgInviteCommand(): Promise<void> {
  const creds = await requireCredentials()
  const orgId = requireActiveOrg(creds.activeOrgId)
  let result: InviteResponse
  try {
    result = await apiRequest<InviteResponse>(creds, `/api/org/${encodeURIComponent(orgId)}/invite`)
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ inviteUrl: result!.inviteUrl }) + '\n')
}

export async function orgInviteRotateCommand(): Promise<void> {
  const creds = await requireCredentials()
  const orgId = requireActiveOrg(creds.activeOrgId)
  let result: InviteResponse
  try {
    result = await apiRequest<InviteResponse>(creds, `/api/org/${encodeURIComponent(orgId)}/invite/regenerate`, {
      method: 'POST',
    })
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ inviteUrl: result!.inviteUrl }) + '\n')
}
