import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface BoardLane { id: string; name: string; type: 'saga' | 'backlog' }
interface BoardResponse { path?: string[]; lanes: BoardLane[] }

export async function laneListCommand(path: string[]): Promise<void> {
  const creds = await requireCredentials()
  const pathParam = path.length > 0 ? path.join(',') : 'root'
  let board: BoardResponse
  try {
    board = await apiRequest<BoardResponse>(creds, `/api/board?path=${encodeURIComponent(pathParam)}`)
  } catch (err) {
    passOrWrap(err, 'api_error')
  }

  process.stdout.write(JSON.stringify({
    path: board!.path ?? ['root', ...path],
    lanes: board!.lanes.map((l) => ({ id: l.id, name: l.name, type: l.type })),
  }) + '\n')
}
