import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface BoardCard { id: string; text: string; status: string; order: string; laneId: string }
interface BoardLane { id: string; name: string; type: 'saga' | 'backlog'; cards: BoardCard[] }
interface ArchivedItem { id: string; archivedAt: number; node: { id: string; text: string; status: string; laneId: string } }
interface BoardResponse { orgId: string; path?: string[]; lanes: BoardLane[]; archived?: ArchivedItem[] }

export async function boardShowCommand(path: string[]): Promise<void> {
  const creds = await requireCredentials()
  const pathParam = path.length > 0 ? path.join(',') : 'root'
  let board: BoardResponse
  try {
    board = await apiRequest<BoardResponse>(creds, `/api/board?path=${encodeURIComponent(pathParam)}`)
  } catch (err) {
    passOrWrap(err, 'api_error')
  }

  process.stdout.write(JSON.stringify({
    orgId: board!.orgId,
    path: board!.path ?? ['root', ...path],
    lanes: board!.lanes,
    archived: board!.archived ?? [],
  }) + '\n')
}
