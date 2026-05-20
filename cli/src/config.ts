import { promises as fs, constants as fsConst } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLIError } from './errors.js'

export interface Credentials {
  apiUrl: string
  token: string
  userId: string
  email?: string
  activeOrgId?: string | null
}

const DEFAULT_API_URL = 'https://server-production-64f5.up.railway.app'

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = typeof xdg === 'string' && xdg.length > 0 ? xdg : join(homedir(), '.config')
  return join(base, 'zigzag')
}

export function credentialsFilePath(): string {
  return join(configDir(), 'credentials.json')
}

export function defaultApiUrl(): string {
  const env = process.env.ZIGZAG_API_URL
  if (typeof env === 'string' && env.length > 0) return env
  return DEFAULT_API_URL
}

async function pathExists(path: string): Promise<boolean> {
  return fs
    .access(path, fsConst.F_OK)
    .then(() => true)
    .catch((err: unknown) => {
      if (isNoEnt(err)) return false
      throw new CLIError({ error: 'state', message: `could not check ${path}: ${(err as Error).message}` })
    })
}

export async function readCredentials(): Promise<Credentials | null> {
  const path = credentialsFilePath()
  if (!(await pathExists(path))) return null
  const raw = await fs.readFile(path, 'utf8').catch((err: unknown) => {
    throw new CLIError({ error: 'state', message: `could not read credentials: ${(err as Error).message}` })
  })
  let parsed: Partial<Credentials>
  try {
    parsed = JSON.parse(raw) as Partial<Credentials>
  } catch (err) {
    throw new CLIError({
      error: 'state',
      message: 'credentials file is corrupt',
      next: 'run `zigzag auth login` to overwrite it',
    })
  }
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

export async function writeCredentials(creds: Credentials): Promise<void> {
  const dir = configDir()
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const path = credentialsFilePath()
  await fs.writeFile(path, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 })
  await fs.chmod(path, 0o600)
}

export async function clearCredentials(): Promise<void> {
  const path = credentialsFilePath()
  if (!(await pathExists(path))) return
  await fs.unlink(path).catch((err: unknown) => {
    throw new CLIError({ error: 'state', message: `could not delete credentials: ${(err as Error).message}` })
  })
}

export async function requireCredentials(): Promise<Credentials> {
  const creds = await readCredentials()
  if (creds === null) {
    throw new CLIError({
      error: 'not_authenticated',
      message: 'not logged in',
      next: 'run `zigzag auth login`',
    })
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
