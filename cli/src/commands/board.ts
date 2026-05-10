import { requireCredentials } from '../config.js'
import { apiRequest, ApiError } from '../api.js'
import { printResult, type OutputMode } from '../output.js'
import { CLIError } from '../errors.js'

interface BoardCard { id: string; text: string; status: string; order: string }
interface BoardLane { id: string; name: string; type: 'saga' | 'backlog'; cards: BoardCard[] }
interface BoardResponse { orgId: string; lanes: BoardLane[] }

interface NoActiveOrgError { error: 'no_active_org'; orgs: { id: string; name: string; slug: string }[] }

export async function boardShowCommand(mode: OutputMode): Promise<void> {
  const creds = await requireCredentials()
  let board: BoardResponse
  try {
    board = await apiRequest<BoardResponse>(creds, '/api/board')
  } catch (err) {
    // 409 with `no_active_org` is recoverable — the server lists the orgs
    // the user can pick from. Translate to a CLI hint instead of dumping
    // the raw error code.
    if (err instanceof ApiError && err.status === 409 && isNoActiveOrgBody(err.body)) {
      const orgs = err.body.orgs
      const lines = orgs.length === 0
        ? 'You are not a member of any organization yet.'
        : `Available orgs:\n${orgs.map((o) => `  ${o.name}  ${o.slug}  ${o.id}`).join('\n')}`
      throw new CLIError(
        'state',
        'no active organization',
        `run \`zigzag org use <id|slug>\` first.\n${lines}`,
      )
    }
    throw err
  }

  printResult(
    mode,
    board,
    formatBoardHuman(board),
  )
}

function isNoActiveOrgBody(body: unknown): body is NoActiveOrgError {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return b.error === 'no_active_org' && Array.isArray(b.orgs)
}

function formatBoardHuman(board: BoardResponse): string[] {
  const lines: string[] = [`Board (org: ${board.orgId})`]
  if (board.lanes.length === 0) {
    lines.push('  (no lanes)')
    return lines
  }
  for (const lane of board.lanes) {
    lines.push('')
    lines.push(`# ${lane.name}  [${lane.type}]  ${lane.id}`)
    if (lane.cards.length === 0) {
      lines.push('  (empty)')
      continue
    }
    for (const card of lane.cards) {
      const statusBadge = card.status === 'done' ? '[x]' : card.status === 'doing' ? '[~]' : '[ ]'
      lines.push(`  ${statusBadge} ${card.text}  (${card.id})`)
    }
  }
  return lines
}
