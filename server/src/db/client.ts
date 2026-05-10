import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'
import { buildSslConfig } from './ssl.js'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
  max: 10,
})

export const db = drizzle({ client: pool, schema })
