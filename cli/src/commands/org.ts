import { requireCredentials, setActiveOrg } from '../config.js'
import { apiRequest } from '../api.js'
import { printResult, type OutputMode } from '../output.js'
import { CLIError } from '../errors.js'

interface OrgMembership { id: string; name: string; slug: string; role?: string }
interface MeResponse {
  orgs: OrgMembership[]
  activeOrganizationId: string | null
}

export async function orgListCommand(mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  const me = await apiRequest<MeResponse>(creds, '/api/org/me', { attachOrg: false })
  const activeOrgId = creds.activeOrgId !== undefined && creds.activeOrgId !== null
    ? creds.activeOrgId
    : me.activeOrganizationId

  printResult(
    mode,
    { activeOrgId, orgs: me.orgs },
    me.orgs.length === 0
      ? ['(no organizations — create or join one in the web app)']
      : me.orgs.map((o) => {
          const marker = o.id === activeOrgId ? '* ' : '  '
          const role = typeof o.role === 'string' ? `  [${o.role}]` : ''
          return `${marker}${o.name}  (${o.slug})  ${o.id}${role}`
        }),
  )
}

export async function orgUseCommand(target: string): Promise<void> {
  const creds = await requireCredentials()
  const me = await apiRequest<MeResponse>(creds, '/api/org/me', { attachOrg: false })

  // Match by id first, then by slug. Names are not unique enough to be a
  // safe selector; users who only know a name can run `org list` to look
  // up the slug or id.
  const match = me.orgs.find((o) => o.id === target) ?? me.orgs.find((o) => o.slug === target)
  if (match === undefined) {
    throw new CLIError(
      'usage',
      `no membership matching "${target}"`,
      'run `zigzag org list` to see available organizations',
    )
  }

  await setActiveOrg(match.id)
  process.stdout.write(`Active org: ${match.name} (${match.slug})\n`)
}
