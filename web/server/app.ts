import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { forwardTo } from './forward'
import { handleRooms, ROOM_RULES } from './rooms/handler'
import { roomHub } from './rooms/hub'
import { memoryRooms } from './rooms/store'
import { handleSpeak } from './voice/speak'
import type { Deps } from './deps'
import { checkedRedisStatus } from '../shared/cacheStats'
import { reply } from '../shared/http'
import { region, unavailableDrill } from '../shared/region'
import { memoryStore } from '../shared/store'
import { statsEndpoint } from './stats'
import { serveStatic } from './static'
import { tracedBy } from '../shared/traced'
import { serveMedia, serveTile } from './storage'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/**
 * The web server: the front door. It serves the built pages, terrain tiles and the demo video
 * streamed from Cloud Storage, Scout's voice, presenters' rooms, and its own status. Everything it
 * needs from outside comes in through `deps`.
 *
 * It does not answer the co-pilot (`/api/chat`, `/api/ask`) or plans (`/api/plans`). Those are their
 * own services (`web/copilot/`, `web/plans/`), and the load balancer sends them their paths, so this
 * server never sees them. Asked for one on its own address, it answers 404 like any path it does not
 * have. On one machine there is no load balancer, so it passes those paths on (`plansUrl`,
 * `copilotUrl`).
 */
export function createApp(deps: Deps): Hono {
  const now = deps.now ?? Date.now
  const store = deps.store ?? memoryStore(now)
  // Scout says one answer per question, so the voice gets the co-pilot's per-visitor limits (6 a minute,
  // 60 a day; copilot/limits.ts). The daily
  // ceiling is much lower: 200 texts of at most 900 characters is the most the voice can cost in a day,
  // and past it the page uses the browser's own voice. A text said again within a day comes from the
  // cache and counts only against the visitor's minute.
  const speakLimits = {
    each: store.limiter('speak:each', 6, MINUTE_MS),
    eachDay: store.limiter('speak:each-day', 60, DAY_MS),
    all: store.limiter('speak:all', 30, MINUTE_MS),
    allDay: store.limiter('speak:all-day', 200, DAY_MS),
  }
  // Follow the presenter. Starting a room is rare; a presenter's page publishes at most once a second;
  // a follower opens one stream per page and one more each minute, and a whole room can share one address.
  const roomLimits = {
    start: store.limiter('rooms:start', 10, 10 * MINUTE_MS),
    startAll: store.limiter('rooms:start-all', 120, 60 * MINUTE_MS),
    move: store.limiter('rooms:move', 90, MINUTE_MS),
    join: store.limiter('rooms:join', 120, MINUTE_MS),
  }
  const rooms = deps.rooms === undefined ? memoryRooms(now) : deps.rooms
  const hub = rooms ? roomHub(rooms, ROOM_RULES) : null
  // Handles one API request as a trace (shared/traced.ts): its steps are timed and sent to Cloud Trace.
  const traced = tracedBy(deps.traces, now)
  // On one machine there is no load balancer to send /api/plans to the plans service, or /api/chat,
  // /api/chat/* and /api/ask to the co-pilot service, so this server passes them on. That is all it
  // can do with them: without an address to pass them to, they are unknown paths (404, below).
  const toPlans = deps.plansUrl ? forwardTo(deps.plansUrl) : null
  const toCopilot = deps.copilotUrl ? forwardTo(deps.copilotUrl) : null

  const app = new Hono()

  // Phase 8's failover drill: with DRILL_UNAVAILABLE=on every request is answered 503 (shared/region.ts).
  app.use(unavailableDrill())
  // Shrinks text (pages, scripts, JSON data) on the way out. Tiles and video are left as they are.
  app.use(compress())

  if (toCopilot) {
    app.all('/api/ask', (c) => toCopilot(c.req.raw))
    app.all('/api/chat', (c) => toCopilot(c.req.raw))
    app.all('/api/chat/*', (c) => toCopilot(c.req.raw))
  }
  if (toPlans) {
    app.all('/api/plans', (c) => toPlans(c.req.raw))
    app.all('/api/plans/*', (c) => toPlans(c.req.raw))
  }
  app.all('/api/speak', (c) => traced('POST /api/speak', c.req.raw, () => handleSpeak(c.req.raw, deps, speakLimits, store.cache)))
  app.all('/api/rooms', (c) => traced('POST /api/rooms', c.req.raw, () => handleRooms(c.req.raw, deps, roomLimits, rooms, hub, '')))
  app.all('/api/rooms/*', (c) => {
    const rest = new URL(c.req.url).pathname.slice('/api/rooms'.length)
    return traced(`${c.req.method} /api/rooms/<id>${rest.endsWith('/events') ? '/events' : ''}`, c.req.raw, () => handleRooms(c.req.raw, deps, roomLimits, rooms, hub, rest))
  })
  // Today's counts of co-pilot questions, for the How it works page. Read-only: the events worker keeps them.
  const readStats = statsEndpoint(deps.stats, now)
  app.get('/api/stats', (c) => traced('GET /api/stats', c.req.raw, readStats))
  // What this copy of the server is running with. No secrets: just which optional parts are switched on.
  // `plans`, `copilot` and `questionLog` are always false and `copilotCodeVersion` always null: this
  // server runs none of them. They stay in the reply because the rule for this API is that fields are
  // never removed, and `elsewhere` says where each one's own status is. Those two addresses answer
  // through the site's public address (the load balancer) or on one machine (passed on), and are
  // 404 on this server's own address in the cloud. `/api/status/services` asks both for this server.
  // `redis` says where this copy's limits, voice clips and rooms are served from right now (shared/cacheStats.ts).
  const elsewhere = { plans: '/api/plans/status', copilot: '/api/chat/status' }
  app.get('/api/status', async () => reply({ limitsAndCache: store.kind, redis: await checkedRedisStatus(store, deps.redis), plans: false, copilot: false, questionLog: false, tracing: Boolean(deps.traces), voice: Boolean(deps.speech), follow: rooms ? { rooms: rooms.kind, streams: hub?.streams() ?? 0 } : false, signIn: deps.signInClientId ?? null, revision: process.env.K_REVISION ?? null, region: region(), dataVersion: deps.dataVersion ?? null, counts: Boolean(deps.stats), copilotCodeVersion: null, elsewhere }))
  // How the plans and co-pilot services are, asked with this server's identity (./services.ts). For the How it works page.
  const services = deps.services
  app.get('/api/status/services', (c) =>
    services ? traced('GET /api/status/services', c.req.raw, async () => reply(await services.check())) : reply({ checkedAt: new Date(now()).toISOString(), services: {} }),
  )
  app.all('/api/*', () => reply({ error: 'not-found' }, 404))
  app.all('/tiles/*', (c) => serveTile(c.req.raw, deps.bucket, new URL(c.req.url).pathname))
  app.all('/media/*', (c) => serveMedia(c.req.raw, deps.bucket, new URL(c.req.url).pathname))
  app.all('*', (c) => serveStatic(c.req.raw, deps.distDir, new URL(c.req.url).pathname))

  app.onError((error) => {
    console.error(error)
    return reply({ error: 'server' }, 500)
  })
  return app
}
