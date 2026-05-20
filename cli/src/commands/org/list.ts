import { requireCredentials } from '../../config.js'
import { apiRequest } from '../../api.js'

interface OrgMembership { id: string; name: string; slug: string; role?: string }
interface MeResponse { orgs: OrgMembership[]; activeOrganizationId: string | null }

export async function orgListCommand(): Promise<void> {
  const creds = await requireCredentials()
  const me = await apiRequest<MeResponse>(creds, '/api/org/me', { attachOrg: false })
  const activeOrgId = creds.activeOrgId ?? me.activeOrganizationId

  // Sorted by name ascending.
  const orgs = [...me.orgs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role ?? null }))

  process.stdout.write(JSON.stringify({ activeOrgId, orgs }) + '\n')
}
