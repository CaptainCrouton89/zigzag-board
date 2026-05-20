import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface CardResponse { card: { id: string; text: string; status: string; laneId: string; order: string } }

export async function cardRestoreCommand(archivedItemId: string, path: string[]): Promise<void> {
  const creds = await requireCredentials()
  const pathArr = path.length > 0 ? path : undefined
  let result: CardResponse
  try {
    result = await apiRequest<CardResponse>(
      creds,
      `/api/board/cards/${encodeURIComponent(archivedItemId)}/restore`,
      { method: 'POST', body: { path: pathArr } },
    )
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ card: result!.card }) + '\n')
}
