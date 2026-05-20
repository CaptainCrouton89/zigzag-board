import { requireCredentials, setActiveOrg } from '../../config.js'
import { apiRequest } from '../../api.js'
import { CLIError } from '../../errors.js'

interface CreateOrgResponse { organizationId: string; inviteUrl: string }

export async function orgCreateCommand(name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new CLIError({ error: 'invalid_input', message: 'organization name required', expected: 'non-empty string' })
  }
  const creds = await requireCredentials()
  const result = await apiRequest<CreateOrgResponse>(creds, '/api/org', {
    method: 'POST',
    attachOrg: false,
    body: { name: trimmed },
  })
  await setActiveOrg(result.organizationId)
  process.stdout.write(JSON.stringify({
    organizationId: result.organizationId,
    inviteUrl: result.inviteUrl,
    activeOrgId: result.organizationId,
  }) + '\n')
}
