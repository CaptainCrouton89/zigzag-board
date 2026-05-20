import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'
import { CLIError } from '../../errors.js'

interface LaneResponse { lane: { id: string; name: string; type: 'saga' | 'backlog' } }

export async function laneUpdateCommand(laneId: string, opts: {
  name?: string
  type?: 'saga' | 'backlog'
  path: string[]
}): Promise<void> {
  if (opts.name === undefined && opts.type === undefined) {
    throw new CLIError({
      error: 'no_changes',
      message: 'no changes specified',
      received: opts,
      expected: 'at least one of --name or --type',
      next: 'pass --name or --type or both',
    })
  }
  const creds = await requireCredentials()
  const pathArr = opts.path.length > 0 ? opts.path : undefined
  const body: Record<string, unknown> = { path: pathArr }
  if (opts.name !== undefined) body.name = opts.name
  if (opts.type !== undefined) body.type = opts.type
  let result: LaneResponse
  try {
    result = await apiRequest<LaneResponse>(creds, `/api/board/lanes/${encodeURIComponent(laneId)}`, {
      method: 'PATCH',
      body,
    })
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ lane: result!.lane }) + '\n')
}
