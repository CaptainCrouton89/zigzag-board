import { requireCredentials, setActiveOrg } from '../../config.js'
import { apiRequest } from '../../api.js'
import { CLIError } from '../../errors.js'

interface OrgMembership { id: string; name: string; slug: string }
interface MeResponse { orgs: OrgMembership[]; activeOrganizationId: string | null }

export async function orgUseCommand(target: string): Promise<void> {
  const creds = await requireCredentials()
  const me = await apiRequest<MeResponse>(creds, '/api/org/me', { attachOrg: false })

  const match = me.orgs.find((o) => o.id === target) ?? me.orgs.find((o) => o.slug === target)
  if (match === undefined) {
    throw new CLIError({
      error: 'no_match',
      message: `no membership matching "${target}"`,
      received: target,
      expected: 'id or slug from `zigzag org list`',
      next: 'run `zigzag org list` to see memberships',
    })
  }

  await setActiveOrg(match.id)
  process.stdout.write(JSON.stringify({ activeOrgId: match.id, name: match.name, slug: match.slug }) + '\n')
}
