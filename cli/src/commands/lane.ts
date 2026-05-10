import { requireCredentials } from '../config.js'
import { apiRequest, ApiError } from '../api.js'
import { printResult, type OutputMode } from '../output.js'
import { CLIError } from '../errors.js'

type LaneType = 'saga' | 'backlog'
interface LaneResponse {
  lane: { id: string; name: string; type: LaneType }
}

interface AddOptions { name: string; type?: LaneType }

export async function laneAddCommand(opts: AddOptions, mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  const type = opts.type === 'backlog' ? 'backlog' : 'saga'
  const result = await apiRequest<LaneResponse>(creds, '/api/board/lanes', {
    method: 'POST',
    body: { name: opts.name, type },
  })
  printResult(
    mode,
    result.lane,
    [`added lane ${result.lane.id} (${result.lane.type})`],
  )
}

interface RenameOptions { name: string }

export async function laneRenameCommand(laneId: string, opts: RenameOptions, mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  const result = await apiRequest<LaneResponse>(creds, `/api/board/lanes/${encodeURIComponent(laneId)}`, {
    method: 'PATCH',
    body: { name: opts.name },
  })
  printResult(mode, result.lane, [`renamed lane ${result.lane.id} → "${result.lane.name}"`])
}

interface TypeOptions { type: LaneType }

export async function laneTypeCommand(laneId: string, opts: TypeOptions, mode: OutputMode): Promise<void> {
  if (opts.type !== 'saga' && opts.type !== 'backlog') {
    throw new CLIError('usage', '--type must be "saga" or "backlog"')
  }
  const creds = await requireCredentials()
  const result = await apiRequest<LaneResponse>(creds, `/api/board/lanes/${encodeURIComponent(laneId)}`, {
    method: 'PATCH',
    body: { type: opts.type },
  })
  printResult(mode, result.lane, [`lane ${result.lane.id} type → ${result.lane.type}`])
}

export async function laneRmCommand(laneId: string, mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  try {
    await apiRequest<{ ok: true }>(creds, `/api/board/lanes/${encodeURIComponent(laneId)}`, {
      method: 'DELETE',
    })
  } catch (err) {
    // The server refuses non-empty lanes with 409 to enforce the same
    // invariant the web app gets for free (no delete UI). Re-cast as a
    // CLI usage hint with the recovery action spelled out.
    if (err instanceof ApiError && err.status === 409) {
      throw new CLIError(
        'state',
        'lane is not empty',
        'move or delete its cards first, then retry',
      )
    }
    throw err
  }
  printResult(mode, { ok: true, id: laneId }, [`removed lane ${laneId}`])
}
