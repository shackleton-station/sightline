import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { checkedRedisStatus } from '../shared/cacheStats'
import { reply } from '../shared/http'
import { region, unavailableDrill } from '../shared/region'
import type { RedisConnection } from '../shared/redisClient'
import type { StatusCheck } from '../shared/statusCaller'
import { memoryStore, type SharedStore } from '../shared/store'
import { siteData } from '../shared/tools/data'
import type { TraceSink } from '../shared/trace'
import { tracedBy } from '../shared/traced'
import { handlePlans, planLimits, type PlansDeps } from './handler'
import { KEY_HOURS } from './idempotency'

/** What the plans service needs from outside itself. Tests pass fakes; `index.ts` passes the real ones. */
export interface PlansServiceDeps extends PlansDeps {
  /** The pipeline's JSON, which a plan's brief is worked out from. The image carries its own copy. */
  dataDir: string
  /** Rate-limit counts. Defaults to this process's memory; Redis in production. */
  store?: SharedStore
  /** Whether the connection to Redis is up right now. Only passed when the limits are on Redis. */
  limitsReachable?: () => boolean
  /** What the connection to Redis is doing, for the status. Only passed when the limits are on Redis. */
  redis?: RedisConnection
  /** Where request traces go (Cloud Trace); nothing when not configured. */
  traces?: TraceSink | null
  /** The commit this image was built from. */
  version: string
  /** A hash of the site data in the image (see `scripts/data-version.mjs`). */
  dataVersion: string | null
  /** Cloud Run's name for this deploy. */
  revision: string | null
  /** Checks the token on the status path meant for the web server; null: that path answers 503. */
  statusCheck?: StatusCheck | null
}

const NAME = 'plans'
/**
 * The service's status address. It sits under /api/plans/ so that it is reachable through the
 * site's public address, where the load balancer sends only /api/plans and /api/plans/* here.
 * It cannot be mistaken for a plan: a plan's id is always 8 letters, and this word has 6.
 */
export const STATUS_PATH = '/api/plans/status'
/** The status for the web server only, checked by its identity token. */
export const STATUS_FOR_WEB_PATH = '/api/plans/status/web'

/**
 * The plans service: save, open, list and delete shared mission plans, with the sign-in check.
 * It is the only program that answers /api/plans and /api/plans/*: the load balancer sends it those
 * paths, and the web server has no handler for them. It owns the Firestore database `plans`.
 *
 * Built with no bucket: a plan's brief uses two of the read-only data tools, and neither reads the
 * light grid, so this service needs no access to Cloud Storage.
 */
export function createPlansApp(deps: PlansServiceDeps): Hono {
  const now = deps.now ?? Date.now
  const store = deps.store ?? memoryStore(now)
  const limits = planLimits(store)
  const data = siteData(deps.dataDir)
  const traced = tracedBy(deps.traces, now)

  const app = new Hono()
  // Phase 8's failover drill: with DRILL_UNAVAILABLE=on every request is answered 503 (shared/region.ts).
  app.use(unavailableDrill())
  // Shrinks a long answer (a plan with its brief) on the way out, as the web server does.
  app.use(compress())

  // What this copy is running. No secrets: the version, the data it carries, and which parts are switched on.
  const status = async () => ({
    service: NAME,
    version: deps.version,
    revision: deps.revision,
    // Which region this copy runs in (Phase 8: there may be two). Null on a laptop.
    region: region(),
    dataVersion: deps.dataVersion,
    store: deps.plans?.kind ?? 'none',
    // Limits on Redis fall back to this copy's memory while Redis cannot be reached, without failing
    // a request. That is right for a visitor and easy to miss in a deploy, so the status says so.
    limits: store.kind === 'redis' && deps.limitsReachable?.() === false ? 'redis-unreachable' : store.kind,
    // Where this copy's rate limits are counted right now: `redis`, `fallback` (the last call to
    // Redis failed and memory answered), `reconnecting` or `memory` (shared/cacheStats.ts).
    redis: await checkedRedisStatus(store, deps.redis),
    signIn: Boolean(deps.identity),
    tracing: Boolean(deps.traces),
    idempotencyKeyHours: KEY_HOURS,
  })
  app.get(STATUS_PATH, async () => reply(await status()))
  // The same, for the web server's "how are the services" page, only with a token from Google that
  // says the caller is the web server and was made for this service (shared/statusCaller.ts). It says
  // nothing the public status does not; the point is the check. Not a plan: a plan's id has no slash.
  app.get(STATUS_FOR_WEB_PATH, async (c) => {
    if (!deps.statusCheck) return reply({ error: 'not-configured' }, 503)
    const caller = await deps.statusCheck(c.req.header('authorization') ?? null)
    if (!caller.ok) return reply({ error: 'caller', why: caller.why }, caller.why === 'not-web' ? 403 : 401)
    return reply({ ...(await status()), checkedAs: 'web' })
  })
  app.all('/api/plans',(c) => traced(`${c.req.method} /api/plans`, c.req.raw, () => handlePlans(c.req.raw, deps, limits, data, '')))
  app.all('/api/plans/*', (c) => traced(`${c.req.method} /api/plans/<id>`, c.req.raw, () => handlePlans(c.req.raw, deps, limits, data, new URL(c.req.url).pathname.slice('/api/plans'.length))))
  // Nothing else lives here. The load balancer never sends another path; someone on the service's own address might.
  app.all('*', () => reply({ error: 'not-found' }, 404))

  app.onError((error) => {
    console.error(error)
    return reply({ error: 'server' }, 500)
  })
  return app
}
