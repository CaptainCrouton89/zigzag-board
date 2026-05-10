import { requireCredentials } from '../config.js'
import { apiRequest } from '../api.js'
import { printResult, type OutputMode } from '../output.js'

interface OrgMembership { id: string; name: string; slug: string; role?: string }
interface MeResponse {
  orgs: OrgMembership[]
  activeOrganizationId: string | null
}

export async function whoamiCommand(mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  const me = await apiRequest<MeResponse>(creds, '/api/org/me', { attachOrg: false })
  const activeOrgId = creds.activeOrgId !== undefined && creds.activeOrgId !== null
    ? creds.activeOrgId
    : me.activeOrganizationId
  const activeOrg = me.orgs.find((o) => o.id === activeOrgId)

  printResult(
    mode,
    {
      userId: creds.userId,
      email: creds.email,
      apiUrl: creds.apiUrl,
      activeOrg: activeOrg !== undefined ? activeOrg : null,
      orgs: me.orgs,
    },
    [
      `userId:    ${creds.userId}`,
      `email:     ${typeof creds.email === 'string' ? creds.email : '(unknown)'}`,
      `apiUrl:    ${creds.apiUrl}`,
      activeOrg !== undefined
        ? `activeOrg: ${activeOrg.name} (${activeOrg.id})`
        : 'activeOrg: (none — run `zigzag org use <id>`)',
      `orgs:      ${me.orgs.length} membership${me.orgs.length === 1 ? '' : 's'}`,
    ],
  )
}
