import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'
import { CLIError } from '../../errors.js'

interface LaneResponse { lane: { id: string; name: string; type: 'saga' | 'backlog' } }

export async function laneMoveCommand(laneId: string, opts: {
  before?: string
  after?: string
  path: string[]
}): Promise<void> {
  if (opts.before !== undefined && opts.after !== undefined) {
    throw new CLIError({
      error: 'exclusive_flags',
      message: '--before and --after are mutually exclusive',
      received: { before: opts.before, after: opts.after },
      expected: 'exactly one of --before or --after',
    })
  }
  if (opts.before === undefined && opts.after === undefined) {
    throw new CLIError({
      error: 'missing_position',
      message: 'position required',
      expected: 'exactly one of --before or --after',
      next: 'pass --before <laneId> or --after <laneId>',
    })
  }
  const creds = await requireCredentials()
  const pathArr = opts.path.length > 0 ? opts.path : undefined
  let result: LaneResponse
  try {
    result = await apiRequest<LaneResponse>(creds, `/api/board/lanes/${encodeURIComponent(laneId)}/move`, {
      method: 'POST',
      body: { before: opts.before, after: opts.after, path: pathArr },
    })
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ lane: result!.lane }) + '\n')
}
