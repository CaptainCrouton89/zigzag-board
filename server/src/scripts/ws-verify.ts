import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { splitSetCookieHeader } from 'better-auth/cookies'
import { WebSocket as NodeWS } from 'ws'
import * as Y from 'yjs'

if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL required')
if (!process.env.WEB_ORIGIN) throw new Error('WEB_ORIGIN required')
const API = process.env.BETTER_AUTH_URL
const WS = API.replace(/^http/, 'ws') + '/sync'
const WEB_ORIGIN = process.env.WEB_ORIGIN

async function jsonFetch(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (init.cookie) headers.set('cookie', init.cookie)
  headers.set('origin', WEB_ORIGIN)
  const res = await fetch(API + path, { ...init, headers })
  const rawSetCookie = res.headers.get('set-cookie')
  const setCookie = rawSetCookie !== null ? rawSetCookie : ''
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()
  return { status: res.status, setCookie, body }
}

function extractCookie(setCookie: string): string {
  // better-auth.session_token=...; HttpOnly; Secure; SameSite=None; Partitioned; Path=/
  return splitSetCookieHeader(setCookie).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
}

function makeCookieWS(cookie: string, origin: string): typeof WebSocket {
  return class extends NodeWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { Cookie: cookie, Origin: origin } })
    }
  } as unknown as typeof WebSocket
}

// label = human log prefix; docName = Hocuspocus document name (org ID).
// The plan source conflated the two; split here so the server's membership
// check receives the actual org ID while the log output shows the readable label.
async function connect(label: string, docName: string, cookie: string, origin: string) {
  const ydoc = new Y.Doc()
  const wsProvider = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: makeCookieWS(cookie, origin) })
  const provider = new HocuspocusProvider({
    websocketProvider: wsProvider, name: docName, document: ydoc, token: '',
    awareness: null,
    onAuthenticationFailed({ reason }) { console.log(`[${label}] AUTH_FAIL:`, reason) },
    onSynced() {
      const lanesMap = ydoc.getMap('root').get('lanes') as Y.Map<unknown> | undefined
      console.log(`[${label}] SYNCED lanes=${lanesMap ? lanesMap.size : 0}`)
    },
    onClose({ event }) { console.log(`[${label}] CLOSE code=${event.code}`) },
  })
  // attach() is not called automatically when using an external websocketProvider
  // (manageSocket=false path skips the auto-attach). Must call explicitly.
  provider.attach()
  return { ydoc, provider, wsProvider }
}

;(async () => {
  // --- HTTP fixtures ---
  const a = await jsonFetch('/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ email: 'a@example.com', password: 'password12345', name: 'Alice' }) })
  const aliceCookie = extractCookie(a.setCookie)
  const tOrg = await jsonFetch('/api/org', { method: 'POST', cookie: aliceCookie, body: JSON.stringify({ name: 'Test Org' }) })
  const T = (tOrg.body as { organizationId: string }).organizationId
  const inviteCode = (tOrg.body as { inviteUrl: string }).inviteUrl.split('/').pop()!
  const oOrg = await jsonFetch('/api/org', { method: 'POST', cookie: aliceCookie, body: JSON.stringify({ name: 'Other Org' }) })
  const O = (oOrg.body as { organizationId: string }).organizationId
  const b = await jsonFetch('/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ email: 'b@example.com', password: 'password12345', name: 'Bob' }) })
  const bobCookie = extractCookie(b.setCookie)
  await jsonFetch(`/api/invite/${inviteCode}/accept`, { method: 'POST', cookie: bobCookie })
  console.log(`FIXTURES T=${T} O=${O}`)

  // --- P1: valid cookie + valid documentName → seeded default lane ---
  const c1 = await connect('P1-alice', T, aliceCookie, WEB_ORIGIN)
  await new Promise(r => setTimeout(r, 1500))
  const lanes = c1.ydoc.getMap('root').get('lanes') as Y.Map<Y.Map<unknown>>
  const lane = lanes?.get('lane-default')
  console.log(`P1 lanes.size=${lanes?.size} lane.title=${lane?.get('title')} lane.type=${lane?.get('type')} lane.order=${lane?.get('order')}`)

  // --- P3: two-client merge ---
  // Reuse c1; add second client. Mutate from Bob; expect Alice to observe.
  const c2 = await connect('P3-bob', T, bobCookie, WEB_ORIGIN)
  await new Promise(r => setTimeout(r, 1000))
  let observedFromAlice = false
  c1.ydoc.on('update', () => { observedFromAlice = true })
  c2.ydoc.transact(() => {
    const existing = c2.ydoc.getMap('root').get('cards') as Y.Map<Y.Map<unknown>> | undefined
    let cards: Y.Map<Y.Map<unknown>>
    if (existing) {
      cards = existing
    } else {
      cards = new Y.Map<Y.Map<unknown>>()
      c2.ydoc.getMap('root').set('cards', cards)
    }
    const card = new Y.Map<unknown>()
    card.set('id', 'card-p3'); card.set('title', 'P3 from Bob'); card.set('status', 'todo'); card.set('laneId', 'lane-default'); card.set('order', 'a0'); card.set('createdAt', Date.now())
    cards.set('card-p3', card)
  }, 'mutation:addCard')
  await new Promise(r => setTimeout(r, 1500))
  console.log(`P3 alice-observed-update=${observedFromAlice}`)

  // --- P2: persistence — wait past debounce window, then verify via psql ---
  await new Promise(r => setTimeout(r, 3000))
  // The implementor verifies P2 via psql (see "psql verification" below).

  // --- N1: bad Origin ---
  const n1 = await connect('N1-bad-origin', T, aliceCookie, 'http://evil.example.com')
  await new Promise(r => setTimeout(r, 1500))
  n1.wsProvider.disconnect()
  await new Promise(r => setTimeout(r, 500))

  // --- N2: no cookie ---
  const n2 = await connect('N2-no-cookie', T, '', WEB_ORIGIN)
  await new Promise(r => setTimeout(r, 1500))
  n2.wsProvider.disconnect()
  await new Promise(r => setTimeout(r, 500))

  // --- N3: non-member documentName (Bob attempts Other Org) ---
  const c3WsProvider = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: makeCookieWS(bobCookie, WEB_ORIGIN) })
  const c3 = new HocuspocusProvider({
    websocketProvider: c3WsProvider, name: O, token: '',
    awareness: null,
    onAuthenticationFailed({ reason }) { console.log(`[N3-bob-other-org] AUTH_FAIL:`, reason) },
    onClose({ event }) { console.log(`[N3-bob-other-org] CLOSE code=${event.code}`) },
  })
  c3.attach()
  await new Promise(r => setTimeout(r, 1500))

  // --- P4: reload (within same process — disconnect & reconnect simulates restart for ydoc-state purposes) ---
  c1.wsProvider.disconnect()
  c2.wsProvider.disconnect()
  c3WsProvider.disconnect()
  await new Promise(r => setTimeout(r, 1500))
  const c4 = await connect('P4-reload-alice', T, aliceCookie, WEB_ORIGIN)
  await new Promise(r => setTimeout(r, 1500))
  const cardsAfter = c4.ydoc.getMap('root').get('cards') as Y.Map<Y.Map<unknown>> | undefined
  console.log(`P4 cards.size=${cardsAfter ? cardsAfter.size : 0} card-p3.title=${(cardsAfter?.get('card-p3'))?.get('title')}`)

  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
