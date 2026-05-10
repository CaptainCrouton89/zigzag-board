import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { auth } from './auth.js'
import orgRoutes from './routes/org.js'
import inviteRoutes from './routes/invite.js'
import cliRoutes from './routes/cli.js'
import { hocuspocus } from './sync/hocuspocus.js'

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

const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })

app.use('/api/*', cors({
  origin: [process.env.WEB_ORIGIN!],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))
app.route('/api/org', orgRoutes)
app.route('/api/invite', inviteRoutes)
app.route('/api/cli', cliRoutes)

app.get('/sync', upgradeWebSocket((c) => {
  let conn: ReturnType<typeof hocuspocus.handleConnection> | undefined
  return {
    onOpen(_evt, ws) {
      // ws.raw is the underlying Node `WebSocket` from the `ws` package.
      // The `@hono/node-ws` adapter already converts binary frames to
      // ArrayBuffer at its layer (see node_modules/@hono/node-ws/dist/index.js
      // — registers ws.on('message', ...) and normalizes), so a manual
      // `ws.raw.binaryType = 'arraybuffer'` write would be a no-op.
      // ws.raw is typed optional in hono's WSContext, but @hono/node-ws
      // always sets it before onOpen. If that ever stops being true, close
      // the socket explicitly rather than leaking a zombie connection that
      // Hocuspocus never sees.
      if (!ws.raw) {
        ws.close(1011, 'ws.raw missing')
        return
      }
      conn = hocuspocus.handleConnection(ws.raw, c.req.raw, {})
    },
    onMessage(evt) {
      if (typeof evt.data === 'string') return // protocol is binary; ignore strays
      conn?.handleMessage(new Uint8Array(evt.data as ArrayBuffer))
    },
    onClose() { conn?.handleClose() },
  }
}))

app.get('/health', (c) => c.json({ ok: true }))

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787), hostname: '0.0.0.0' })
injectWebSocket(server)
