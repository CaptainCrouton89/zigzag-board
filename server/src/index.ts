import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { auth } from './auth.js'

for (const k of ['WEB_ORIGIN', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'DATABASE_URL']) {
  if (!process.env[k]) {
    console.error(`Missing env: ${k}`)
    process.exit(1)
  }
}

if (process.env.BETTER_AUTH_SECRET!.length < 32) {
  console.error('BETTER_AUTH_SECRET must be at least 32 characters (use: openssl rand -hex 32)')
  process.exit(1)
}

const app = new Hono()

app.use('/api/*', cors({
  origin: [process.env.WEB_ORIGIN!],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))
// TODO Phase 3: app.route('/api/org', orgRoutes); app.route('/api/invite', inviteRoutes)

app.get('/health', (c) => c.json({ ok: true }))

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787), hostname: '0.0.0.0' })
void server // TODO Phase 4: injectWebSocket(server) for Hocuspocus
