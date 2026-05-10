import { requireCredentials } from '../config.js'
import { apiRequest } from '../api.js'
import { printResult, type OutputMode } from '../output.js'
import { CLIError } from '../errors.js'

interface CardResponse {
  card: {
    id: string
    text: string
    status: string
    laneId: string
    order: string
  }
}

interface AddOptions {
  lane: string
  text: string
  before?: string
  after?: string
}

export async function cardAddCommand(opts: AddOptions, mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  if (opts.before !== undefined && opts.after !== undefined) {
    throw new CLIError('usage', '--before and --after are mutually exclusive')
  }
  const result = await apiRequest<CardResponse>(creds, '/api/board/cards', {
    method: 'POST',
    body: {
      laneId: opts.lane,
      text: opts.text,
      before: opts.before,
      after: opts.after,
    },
  })
  printResult(
    mode,
    result.card,
    [`added card ${result.card.id} in lane ${result.card.laneId}`],
  )
}

interface MoveOptions {
  lane?: string
  before?: string
  after?: string
}

export async function cardMoveCommand(cardId: string, opts: MoveOptions, mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  if (opts.before !== undefined && opts.after !== undefined) {
    throw new CLIError('usage', '--before and --after are mutually exclusive')
  }
  if (opts.lane === undefined && opts.before === undefined && opts.after === undefined) {
    throw new CLIError(
      'usage',
      'move requires at least one of --lane, --before, --after',
    )
  }
  const result = await apiRequest<CardResponse>(creds, `/api/board/cards/${encodeURIComponent(cardId)}`, {
    method: 'PATCH',
    body: {
      laneId: opts.lane,
      before: opts.before,
      after: opts.after,
    },
  })
  printResult(
    mode,
    result.card,
    [`moved card ${result.card.id} → lane ${result.card.laneId}`],
  )
}

interface EditOptions { text: string }

export async function cardEditCommand(cardId: string, opts: EditOptions, mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  const result = await apiRequest<CardResponse>(creds, `/api/board/cards/${encodeURIComponent(cardId)}`, {
    method: 'PATCH',
    body: { text: opts.text },
  })
  printResult(
    mode,
    result.card,
    [`edited card ${result.card.id}`],
  )
}

export async function cardRmCommand(cardId: string, mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  await apiRequest<{ ok: true }>(creds, `/api/board/cards/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
  })
  printResult(mode, { ok: true, id: cardId }, [`removed card ${cardId}`])
}
