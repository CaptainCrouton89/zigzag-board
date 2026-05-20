import { requireCredentials } from '../../config.js'
import { apiRequest, passOrWrap } from '../../api.js'

export async function laneRmCommand(laneId: string, path: string[]): Promise<void> {
  const creds = await requireCredentials()
  const pathArr = path.length > 0 ? path : undefined
  try {
    await apiRequest<{ ok: true }>(creds, `/api/board/lanes/${encodeURIComponent(laneId)}`, {
      method: 'DELETE',
      body: { path: pathArr },
    })
  } catch (err) {
    passOrWrap(err, 'api_error')
  }
  process.stdout.write(JSON.stringify({ ok: true, id: laneId }) + '\n')
}
