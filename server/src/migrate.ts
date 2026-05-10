import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { buildSslConfig } from './db/ssl.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
  max: 1,
})

try {
  await migrate(drizzle(pool), { migrationsFolder: './migrations' })
  await pool.end()
} catch (e) {
  console.error(e)
  process.exit(1)
}
