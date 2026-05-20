import { CLIError } from './errors.js'
import type { Credentials } from './config.js'

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  authenticated?: boolean
  orgId?: string | null
  attachOrg?: boolean
}

// Thrown when the server returns a non-2xx response.
// body is the parsed JSON response (or raw text) from the server.
export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    const code = extractErrorCode(body)
    super(code !== null ? code : `HTTP ${status}`)
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

  if (options.authenticated !== false) {
    headers.Authorization = `Bearer ${creds.token}`
  }

  if (options.attachOrg !== false) {
    const orgId = options.orgId !== undefined ? options.orgId : (creds.activeOrgId ?? null)
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
    throw new CLIError({
      error: 'network_error',
      message: `request to ${creds.apiUrl}${path} failed: ${(err as Error).message}`,
      next: 'check that the server is reachable and ZIGZAG_API_URL is correct',
    })
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let parsed: unknown = text.length > 0 ? tryParseJson(text) : undefined

  if (!res.ok) {
    if (res.status === 401) {
      throw new CLIError({
        error: 'not_authenticated',
        message: 'session expired or token invalid',
        next: 'run `zigzag auth login` to re-authenticate',
      })
    }
    throw new ApiError(res.status, parsed)
  }

  return parsed as T
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractErrorCode(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error?: unknown }).error
    if (typeof code === 'string' && code.length > 0) return code
  }
  return null
}

// Helper for unauthenticated device-flow requests.
export function credsForApi(apiUrl: string): Credentials {
  return { apiUrl, token: '', userId: '' }
}

// Pass server error bodies through as structured errors when they have the right shape.
export function passOrWrap(err: unknown, fallbackCode: string): never {
  if (err instanceof ApiError) {
    const body = err.body
    if (
      typeof body === 'object' && body !== null &&
      'error' in body && typeof (body as { error: unknown }).error === 'string'
    ) {
      // Server already returned a structured error — pass through as-is.
      process.stdout.write(JSON.stringify(body) + '\n')
      process.exit(1)
    }
    throw new CLIError({
      error: fallbackCode,
      message: err.message,
    })
  }
  throw err
}
