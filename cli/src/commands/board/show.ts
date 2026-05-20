import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface BoardCard { id: string; text: string; status: string; order: string; laneId: string }
interface BoardLane { id: string; name: string; type: 'saga' | 'backlog'; order: string; cards: BoardCard[] }
interface ArchivedItem { id: string; archivedAt: string; node: { id: string; text: string; status: string; laneId: string } }
interface BoardResponse { orgId: string; path: string[]; lanes: BoardLane[]; archived: ArchivedItem[] }

export async function boardShowCommand(path: string[]): Promise<void> {
  const creds = await requireCredentials()
  const pathParam = path.length > 0 ? path.join(',') : 'root'
  let board: BoardResponse
  try {
    board = await apiRequest<BoardResponse>(creds, `/api/board?path=${encodeURIComponent(pathParam)}`)
  } catch (err) {
    passOrWrap(err, 'api_error')
  }

  // Sort lanes by fractional order ascending.
  const lanes = [...board!.lanes].sort((a, b) => compareFractionalValues(a.order, b.order)).map((lane) => ({
    id: lane.id,
    name: lane.name,
    type: lane.type,
    // Sort cards by order ascending, then id as tiebreaker.
    cards: [...lane.cards].sort((a, b) => {
      const ord = compareFractionalValues(a.order, b.order)
      return ord !== 0 ? ord : a.id.localeCompare(b.id)
    }).map((c) => ({ id: c.id, text: c.text, status: c.status, order: c.order, laneId: c.laneId })),
  }))

  // Sort archived by archivedAt descending.
  const archived = [...(board!.archived ?? [])].sort((a, b) =>
    b.archivedAt.localeCompare(a.archivedAt),
  )

  process.stdout.write(JSON.stringify({
    orgId: board!.orgId,
    path: board!.path ?? (path.length > 0 ? path : ['root']),
    lanes,
    archived,
  }) + '\n')
}

function compareFractionalValues(a: string, b: string): number {
  const na = parseFloat(a)
  const nb = parseFloat(b)
  if (!isNaN(na) && !isNaN(nb)) return na - nb
  return a.localeCompare(b)
}
