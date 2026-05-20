import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface BoardLane { id: string; name: string; type: 'saga' | 'backlog'; order: string }
interface BoardResponse { path: string[]; lanes: BoardLane[] }

export async function laneListCommand(path: string[]): Promise<void> {
  const creds = await requireCredentials()
  const pathParam = path.length > 0 ? path.join(',') : 'root'
  let board: BoardResponse
  try {
    board = await apiRequest<BoardResponse>(creds, `/api/board?path=${encodeURIComponent(pathParam)}`)
  } catch (err) {
    passOrWrap(err, 'api_error')
  }

  // Sorted by fractional order ascending.
  const lanes = [...board!.lanes]
    .sort((a, b) => {
      const na = parseFloat(a.order)
      const nb = parseFloat(b.order)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.order.localeCompare(b.order)
    })
    .map((l) => ({ id: l.id, name: l.name, type: l.type }))

  process.stdout.write(JSON.stringify({
    path: board!.path ?? (path.length > 0 ? path : ['root']),
    lanes,
  }) + '\n')
}
