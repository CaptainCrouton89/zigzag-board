import { readFileSync } from 'node:fs'

export function buildSslConfig(): false | { ca?: string; rejectUnauthorized: boolean } {
  const raw = process.env.DATABASE_SSL
  const mode = raw ? raw.toLowerCase() : 'verify'
  if (mode === 'disable') return false
  if (mode === 'no-verify') return { rejectUnauthorized: false }
  if (process.env.DATABASE_CA_CERT) {
    return { ca: readFileSync(process.env.DATABASE_CA_CERT, 'utf8'), rejectUnauthorized: true }
  }
  return { rejectUnauthorized: true }
}
