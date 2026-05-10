import { promises as fs, constants as fsConst } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CLIError } from './errors.js'

// Credentials live at ~/.config/zigzag/credentials.json (mode 0600 so
// other users on the host cannot read the bearer token). The file format
// is intentionally minimal — adding fields later is forward-compatible
// because we ignore unknown keys on read.
export interface Credentials {
  apiUrl: string
  token: string
  userId: string
  email?: string
  activeOrgId?: string | null
}

const DEFAULT_API_URL = 'https://api.zigzag.app'

function configDir(): string {
  // XDG_CONFIG_HOME wins when set (Linux convention); macOS users typically
  // don't set it so we fall back to ~/.config either way. Using ~/Library
  // would be more macOS-native but makes cross-platform docs more confusing.
  const xdg = process.env.XDG_CONFIG_HOME
  const base = typeof xdg === 'string' && xdg.length > 0 ? xdg : join(homedir(), '.config')
  return join(base, 'zigzag')
}

function credentialsPath(): string {
  return join(configDir(), 'credentials.json')
}

export function defaultApiUrl(): string {
  const env = process.env.ZIGZAG_API_URL
  if (typeof env === 'string' && env.length > 0) return env
  return DEFAULT_API_URL
}

async function pathExists(path: string): Promise<boolean> {
  // fs.access throws on missing/unreadable files; we want a boolean and
  // we explicitly want to NOT swallow real I/O errors. The await-then-
  // ternary pattern via .then().catch() returns false on ENOENT only.
  return fs
    .access(path, fsConst.F_OK)
    .then(() => true)
    .catch((err: unknown) => {
      if (isNoEnt(err)) return false
      // Surface unexpected access errors with full diagnostic chain.
      throw new CLIError(
        'state',
        `could not check ${path}: ${(err as Error).message}`,
        null,
        err,
      )
    })
}

export async function readCredentials(): Promise<Credentials | null> {
  const path = credentialsPath()
  if (!(await pathExists(path))) return null
  // File exists; any read failure now is a genuine error worth surfacing
  // rather than silently treating as not-logged-in.
  const raw = await fs.readFile(path, 'utf8').catch((err: unknown) => {
    throw new CLIError(
      'state',
      `could not read credentials: ${(err as Error).message}`,
      null,
      err,
    )
  })
  const parsed = parseCredentialsJson(raw)
  if (
    typeof parsed.apiUrl !== 'string' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.userId !== 'string'
  ) {
    return null
  }
  return {
    apiUrl: parsed.apiUrl,
    token: parsed.token,
    userId: parsed.userId,
    email: typeof parsed.email === 'string' ? parsed.email : undefined,
    activeOrgId: typeof parsed.activeOrgId === 'string' ? parsed.activeOrgId : null,
  }
}

function parseCredentialsJson(raw: string): Partial<Credentials> {
  // Localized try/catch so the failure message can guide the user to
  // overwrite via login. JSON.parse can throw only SyntaxError, so the
  // narrow scope cannot hide unrelated failures.
  try {
    return JSON.parse(raw) as Partial<Credentials>
  } catch (err) {
    throw new CLIError(
      'state',
      'credentials file is corrupt',
      'run `zigzag login` to overwrite it',
      err,
    )
  }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  const dir = configDir()
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  // Write mode 0600 explicitly. Node's writeFile honors `mode` only when
  // the file is freshly created; if a previous file exists with looser
  // perms, fs.chmod corrects it. Both calls are necessary.
  const path = credentialsPath()
  await fs.writeFile(path, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 })
  await fs.chmod(path, 0o600)
}

export async function clearCredentials(): Promise<void> {
  const path = credentialsPath()
  if (!(await pathExists(path))) return
  // File exists; deletion failure here is a permission/IO problem worth
  // surfacing rather than swallowing.
  await fs.unlink(path).catch((err: unknown) => {
    throw new CLIError(
      'state',
      `could not delete credentials: ${(err as Error).message}`,
      null,
      err,
    )
  })
}

export async function requireCredentials(): Promise<Credentials> {
  const creds = await readCredentials()
  if (creds === null) {
    throw new CLIError('auth', 'not logged in', 'run `zigzag login` to sign in')
  }
  return creds
}

export async function setActiveOrg(orgId: string | null): Promise<void> {
  const creds = await requireCredentials()
  await writeCredentials({ ...creds, activeOrgId: orgId })
}

function isNoEnt(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ENOENT'
}

// Exported so `login` can write the path back in error messages.
export function credentialsFilePath(): string {
  return credentialsPath()
}

// Convenience for assembling requests in api.ts. Centralizing here means
// `dirname` etc. stay private to this module.
export function _internal_dir(): string {
  return dirname(credentialsPath())
}
