import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'
import { CLIError } from '../../errors.js'

interface CardResponse { card: { id: string; text: string; status: string; laneId: string; order: string } }

export async function cardMoveCommand(cardId: string, opts: {
  lane?: string
  before?: string
  after?: string
  path: string[]
}): Promise<void> {
  if (opts.lane === undefined && opts.before === undefined && opts.after === undefined) {
    throw new CLIError({
      error: 'no_changes',
      message: 'no move target specified',
      expected: 'at least one of --lane, --before, --after',
      next: 'pass --lane and/or a position flag',
    })
  }
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
  const body: Record<string, unknown> = { path: pathArr }
  if (opts.lane !== undefined) body.laneId = opts.lane
  if (opts.before !== undefined) body.before = opts.before
  if (opts.after !== undefined) body.after = opts.after

  let result: CardResponse
  try {
    result = await apiRequest<CardResponse>(
      creds,
      `/api/board/cards/${encodeURIComponent(cardId)}`,
      { method: 'PATCH', body },
    )
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ card: result!.card }) + '\n')
}
