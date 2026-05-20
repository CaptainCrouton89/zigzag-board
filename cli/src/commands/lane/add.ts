import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface LaneResponse { lane: { id: string; name: string; type: 'saga' | 'backlog' } }

export async function laneAddCommand(opts: {
  name: string
  type: 'saga' | 'backlog'
  path: string[]
}): Promise<void> {
  const creds = await requireCredentials()
  const pathArr = opts.path.length > 0 ? opts.path : undefined
  let result: LaneResponse
  try {
    result = await apiRequest<LaneResponse>(creds, '/api/board/lanes', {
      method: 'POST',
      body: { name: opts.name, type: opts.type, path: pathArr },
    })
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ lane: result!.lane }) + '\n')
}
