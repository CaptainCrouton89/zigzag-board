import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

interface CardShowResponse {
  card: { id: string; text: string; status: string; laneId: string; order: string }
  lanes: unknown[]
  archived: unknown[]
}

export async function cardShowCommand(cardId: string, path: string[]): Promise<void> {
  const creds = await requireCredentials()
  const pathParam = path.length > 0 ? path.join(',') : 'root'
  let result: CardShowResponse
  try {
    result = await apiRequest<CardShowResponse>(
      creds,
      `/api/board/cards/${encodeURIComponent(cardId)}?path=${encodeURIComponent(pathParam)}`,
    )
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({
    card: result!.card,
    lanes: result!.lanes ?? [],
    archived: result!.archived ?? [],
  }) + '\n')
}
