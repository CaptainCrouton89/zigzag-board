import { CLIError } from './errors.js'
import type { Credentials } from './config.js'

// Thin fetch wrapper with three jobs:
//   1. Attach the bearer token + (optionally) X-Org-Id.
//   2. Translate transport-level failures into CLIError so the top-level
//      handler can render them uniformly.
//   3. Decode JSON-shaped error responses so command code can branch on
//      `err.body.error` codes returned by the server (see board.ts and
//      cli.ts route handlers).
export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  // When false, the request is sent without Authorization. Used by the
  // device-flow start/poll endpoints which are intentionally unauthed.
  authenticated?: boolean
  // When set, sent as X-Org-Id. Falls back to creds.activeOrgId so most
  // callers don't need to pass anything.
  orgId?: string | null
  // When false, do not attach X-Org-Id at all (e.g. for /api/cli/*).
  attachOrg?: boolean
}

export class ApiError extends CLIError {
  status: number
  body: unknown
  constructor(status: number, body: unknown, message: string) {
    super('api', message)
    this.status = status
    this.body = body
  }
}

export async function apiRequest<T>(
  creds: Credentials,
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const method = options.method !== undefined ? options.method : 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  const wantsAuth = options.authenticated !== false
  if (wantsAuth) headers.Authorization = `Bearer ${creds.token}`

  const attachOrg = options.attachOrg !== false
  if (attachOrg) {
    const orgId = options.orgId !== undefined ? options.orgId : (creds.activeOrgId !== undefined ? creds.activeOrgId : null)
    if (typeof orgId === 'string' && orgId.length > 0) {
      headers['X-Org-Id'] = orgId
    }
  }

  let bodyText: string | undefined
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    bodyText = JSON.stringify(options.body)
  }

  let res: Response
  try {
    res = await fetch(`${creds.apiUrl}${path}`, { method, headers, body: bodyText })
  } catch (err) {
    throw new CLIError(
      'network',
      `request to ${creds.apiUrl}${path} failed: ${(err as Error).message}`,
      'check that the server is reachable and ZIGZAG_API_URL is correct',
    )
  }

  if (res.status === 204) return undefined as T

  let parsed: unknown = undefined
  const text = await res.text()
  if (text.length > 0) {
    try { parsed = JSON.parse(text) } catch { parsed = text }
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new CLIError(
        'auth',
        'not authorized',
        'your session may have expired — run `zigzag login` again',
      )
    }
    const message = errorMessageFromBody(parsed, res.status)
    throw new ApiError(res.status, parsed, message)
  }

  return parsed as T
}

function errorMessageFromBody(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error?: unknown }).error
    if (typeof code === 'string' && code.length > 0) return code
  }
  return `HTTP ${status}`
}

// Helper for the unauthenticated parts of the device flow. Constructs a
// minimal Credentials-shaped value so apiRequest can still be reused.
export function credsForApi(apiUrl: string): Credentials {
  return { apiUrl, token: '', userId: '' }
}
