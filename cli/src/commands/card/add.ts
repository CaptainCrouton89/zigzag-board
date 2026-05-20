import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'
import { CLIError } from '../../errors.js'

interface CardResponse { card: { id: string; text: string; status: string; laneId: string; order: string } }

export async function cardAddCommand(opts: {
  lane: string
  text: string
  before?: string
  after?: string
  path: string[]
}): Promise<void> {
  if (opts.before !== undefined && opts.after !== undefined) {
    throw new CLIError({
      error: 'exclusive_flags',
      message: '--before and --after are mutually exclusive',
      received: { before: opts.before, after: opts.after },
      expected: 'at most one of --before or --after',
    })
  }
  const creds = await requireCredentials()
  const pathArr = opts.path.length > 0 ? opts.path : undefined
  let result: CardResponse
  try {
    result = await apiRequest<CardResponse>(creds, '/api/board/cards', {
      method: 'POST',
      body: {
        laneId: opts.lane,
        text: opts.text,
        before: opts.before,
        after: opts.after,
        path: pathArr,
      },
    })
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ card: result!.card }) + '\n')
}
