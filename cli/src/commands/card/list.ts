import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface BoardCard { id: string; text: string; status: string; order: string; laneId: string }
interface BoardLane { id: string; cards: BoardCard[] }
interface BoardResponse { path: string[]; lanes: BoardLane[] }

export async function cardListCommand(opts: {
  path: string[]
  lane?: string
  status?: string
}): Promise<void> {
  const creds = await requireCredentials()
  const pathParam = opts.path.length > 0 ? opts.path.join(',') : 'root'
  let board: BoardResponse
  try {
    board = await apiRequest<BoardResponse>(creds, `/api/board?path=${encodeURIComponent(pathParam)}`)
  } catch (err) {
    passOrWrap(err, 'api_error')
  }

  let items: (BoardCard & { laneId: string })[] = []
  for (const lane of board!.lanes) {
    for (const card of lane.cards) {
      items.push({ ...card, laneId: card.laneId ?? lane.id })
    }
  }

  if (opts.lane !== undefined) {
    items = items.filter((c) => c.laneId === opts.lane)
  }
  if (opts.status !== undefined) {
    items = items.filter((c) => c.status === opts.status)
  }

  // Sorted by laneId, then order ascending, then id as tiebreaker.
  items.sort((a, b) => {
    const lc = a.laneId.localeCompare(b.laneId)
    if (lc !== 0) return lc
    const na = parseFloat(a.order)
    const nb = parseFloat(b.order)
    const oc = !isNaN(na) && !isNaN(nb) ? na - nb : a.order.localeCompare(b.order)
    if (oc !== 0) return oc
    return a.id.localeCompare(b.id)
  })

  process.stdout.write(JSON.stringify({
    path: board!.path ?? (opts.path.length > 0 ? opts.path : ['root']),
    items: items.map((c) => ({ id: c.id, text: c.text, status: c.status, laneId: c.laneId, order: c.order })),
  }) + '\n')
}
