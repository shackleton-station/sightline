import { Hono } from 'hono'
import type { Bucket } from '../shared/bucket'
import { cacheStatus, checkedRedisStatus } from '../shared/cacheStats'
import { reply } from '../shared/http'
import { region, unavailableDrill } from '../shared/region'
import type { StatusCheck } from '../shared/statusCaller'
import type { RedisConnection } from '../shared/redisClient'
import { type Cache, memoryStore, type SharedStore } from '../shared/store'
import { siteData } from '../shared/tools/data'
import type { TraceSink } from '../shared/trace'
import { tracedBy } from '../shared/traced'
import { handleAsk } from './ask'
import { type Breaker, BREAKER } from './breaker'
import { waitSeconds } from './busy'
import { handleHorizons, HORIZONS_PATH, horizonsForTools, type HorizonsLimits } from './horizons'
import { answerVersion, type FlightDeps, handleChat } from './chat/handler'
import type { ClaudeAuth, ClaudeSettings } from './claude'
import type { ClusterState } from './clusterCache'
import type { CopilotDeps } from './deps'
import { copilotLimits, type CopilotLimitNumbers } from './limits'
import { type CallReport, type ModelGuard, modelGuard, RETRY } from './modelCall'
import type { Relay } from './outbox'

/** What the co-pilot service needs from outside itself. Tests pass fakes; `index.ts` passes the real ones. */
export interface CopilotServiceDeps extends CopilotDeps {
  /** The pipeline's JSON, which the tools read. The image carries its own copy. */
  dataDir: string
  /** The bucket with the light grid's months, for the tool that looks up tapped ground; null without one. */
  bucket: Bucket | null
  /** Rate limits and kept answers. Defaults to this process's memory; Redis in production. */
  store?: SharedStore
  /** Whether the connection to Redis is up right now. Only passed when the store is on Redis. */
  limitsReachable?: () => boolean
  /** What the connections to Redis are doing, for the status. Only passed when the store is on Redis. */
  redis?: RedisConnection
  /**
   * Where answers are kept, when that is not the store's own cache: the Redis Cluster, during its
   * window (clusterCache.ts). `clusterState` says whether it is connected.
   */
  answers?: Cache
  clusterState?: () => ClusterState
  /** Pauses and their spread for a request waiting on another's answer (shared/singleFlight.ts), for tests. */
  flight?: Pick<FlightDeps, 'wait' | 'random'>
  /** Gets each question event to the queue without losing it (the outbox); null when nothing is logged. */
  relay?: Relay | null
  /** The circuit breaker around the model. Defaults to one in this process's memory; Redis in production. */
  breaker?: Breaker
  /** Waits and randomness for retries, for tests (a fake clock, seeded jitter). */
  retry?: Partial<Pick<ModelGuard, 'wait' | 'random'>>
  /** Where request traces go (Cloud Trace); nothing when not configured. */
  traces?: TraceSink | null
  /** Checks the token on the status path meant for the web server; null: that path answers 503. */
  statusCheck?: StatusCheck | null
  /** The commit this image was built from. */
  /** The question limits; the code's defaults (limits.ts) when left out. */
  limits?: CopilotLimitNumbers
  version: string
  /** A hash of the co-pilot's code (scripts/copilot-version.mjs): what a kept answer was worked out with. */
  codeVersion: string | null
  /** A hash of the site data in the image (scripts/data-version.mjs). */
  dataVersion: string | null
  /** Cloud Run's name for this deploy. */
  revision: string | null
  /** Which model answers, for the status: `claude`, the `scripted` stand-in, or `claude, with ...` faults during a drill. */
  modelKind?: string
  /** Which Claude, at what speed and effort, for the status. Null with the stand-in. Never the key. */
  modelSettings?: ClaudeSettings | null
  /** How the service signs in to the Anthropic API: `federation`, `api-key` (a laptop) or `none`. Never a token. */
  modelAuth?: ClaudeAuth['kind']
  /** Told about every model call: the service logs one line each (index.ts). */
  modelCallLog?: (call: CallReport) => void
  /** For "Check with Horizons" (horizons.ts): the way out to JPL, so a test can stand in for it, and how this service names itself there. */
  horizonsFetch?: typeof fetch
  horizonsUserAgent?: string
}

const NAME = 'copilot'
/**
 * The service's status address. It sits under /api/chat/ because the load balancer sends this
 * service only /api/chat, /api/chat/* and /api/ask, so that is the only place a status can be seen
 * through the site's public address. The only other thing under /api/chat/ is `horizons`
 * (horizons.ts): the chat itself is `POST /api/chat`, with no path after it, so neither can be
 * mistaken for it. The web
 * server has no such address and answers 404 there, which is how to tell from outside whether an
 * address reaches this service or only the web server.
 */
export const STATUS_PATH = '/api/chat/status'
/**
 * Today's and yesterday's cache hit rates per kind of key, what single flight did, and the memory
 * Redis is using (shared/cacheStats.ts). Public and read-only: counts and a number of bytes.
 */
export const CACHE_STATUS_PATH = '/api/chat/status/cache'
/** The same status with more in it, for the web server only, checked by its token (shared/statusCaller.ts). */
export const STATUS_FOR_WEB_PATH = '/api/chat/status/web'

/**
 * The co-pilot service: `/api/chat` and `/api/ask`, the model, its read-only tools, the answer
 * cache and the cost limits. It is the only program that answers them: the load balancer sends it
 * both paths, and the web server has no handler for either.
 */
export function createCopilotApp(deps: CopilotServiceDeps): Hono {
  const now = deps.now ?? Date.now
  const store = deps.store ?? memoryStore(now)
  const limits = copilotLimits(store, deps.limits)
  const data = siteData(deps.dataDir, deps.bucket)
  const relay = deps.relay ?? null
  const guard = modelGuard({ now, breaker: deps.breaker, report: deps.modelCallLog, ...deps.retry })
  const traced = tracedBy(deps.traces, now)
  const answers = deps.answers ?? store.cache
  // One recompute per key: the lock and the counters are the store's, on the ordinary instance, wherever answers are kept.
  const flight: FlightDeps = { locks: store.locks, counts: store.counts, ...deps.flight }
  const readCacheStatus = cacheStatus(store, deps.redis, now)
  // "Check with Horizons": a visitor gets 6 a minute; everyone together 20 a minute and 2,000 a day
  // that reach JPL (an answer already kept costs JPL nothing and counts only against the visitor's minute).
  const horizonsLimits: HorizonsLimits = {
    each: store.limiter('horizons:each', 6, 60_000),
    all: store.limiter('horizons:all', 20, 60_000),
    allDay: store.limiter('horizons:all-day', 2000, 24 * 60 * 60_000),
  }
  const horizonsDeps = { allowedOrigins: deps.allowedOrigins, trustedProxies: deps.trustedProxies, fetch: deps.horizonsFetch, userAgent: deps.horizonsUserAgent, range: () => data.range() }
  const handlerDeps: CopilotDeps = {
    ...deps,
    answerVersion: deps.answerVersion ?? answerVersion(deps.codeVersion, deps.dataVersion),
    // Scout's own way to the same lookup, for "check this with Horizons".
    horizons: horizonsForTools(deps.dataDir, horizonsDeps, horizonsLimits, store.cache),
  }

  const status = async () => ({
    service: NAME,
    version: deps.version,
    revision: deps.revision,
    region: region(),
    dataVersion: deps.dataVersion,
    codeVersion: deps.codeVersion,
    model: deps.model ? (deps.modelKind ?? 'claude') : 'none',
    // Which Claude answers, at what speed (null: no speed field sent) and effort, and how the service
    // signs in (`federation` in the cloud). Null with the stand-in or no model. Never a key or a token.
    modelSettings:
      deps.model && deps.modelSettings
        ? { model: deps.modelSettings.model, speed: deps.modelSettings.speed, effort: deps.modelSettings.effort, fallbacks: 'default', auth: deps.modelAuth ?? 'none' }
        : null,
    // Limits on Redis fall back to this copy's memory while Redis cannot be reached, without failing
    // a request. That is right for a visitor and easy to miss in a deploy, so the status says so.
    limits: store.kind === 'redis' && deps.limitsReachable?.() === false ? 'redis-unreachable' : store.kind,
    // Where this copy's requests are served from right now (`redis`, `fallback`, `reconnecting` or
    // `memory`), and the read endpoint's connection (shared/cacheStats.ts). One copy's view.
    redis: await checkedRedisStatus(store, deps.redis),
    // Where answers are kept: `cluster` during the Redis Cluster window, else the store.
    answers: deps.answers ? (deps.clusterState?.() === 'connecting' ? 'cluster-connecting' : 'cluster') : store.kind,
    breakerStore: guard.breaker.kind,
    questionLog: Boolean(relay),
    tracing: Boolean(deps.traces),
  })

  const app = new Hono()
  // Phase 8's failover drill: with DRILL_UNAVAILABLE=on every request is answered 503 (shared/region.ts).
  app.use(unavailableDrill())
  // No compression here: the answers are small, and a stream must reach the browser as it is written.

  // What this copy is running. No secrets: the version, the data and code it carries, which parts are on.
  app.get(STATUS_PATH, async () => reply(await status()))
  // The same, and the breaker's state, for the web server's "how are the services" page. Only with
  // a token from Google that says the caller is the web server and was made for this service.
  app.get(STATUS_FOR_WEB_PATH, async (c) => {
    if (!deps.statusCheck) return reply({ error: 'not-configured' }, 503)
    const caller = await deps.statusCheck(c.req.header('authorization') ?? null)
    if (!caller.ok) return reply({ error: 'caller', why: caller.why }, caller.why === 'not-web' ? 403 : 401)
    const breaker = await guard.breaker.peek()
    return reply({ ...(await status()), breaker: { state: breaker.state, retryAfterSeconds: breaker.retryAfterMs > 0 ? waitSeconds(breaker.retryAfterMs) : 0, opensAfter: BREAKER.failures, withinSeconds: BREAKER.windowMs / 1000, openSeconds: BREAKER.openMs / 1000 }, retries: RETRY.attempts - 1 })
  })
  // Hit rates per kind of cached key, what single flight did, and Redis memory. Read-only, and reused for 5 s.
  app.get(CACHE_STATUS_PATH, async () => reply(await readCacheStatus()))
  app.all('/api/chat', (c) => traced('POST /api/chat', c.req.raw, () => handleChat(c.req.raw, handlerDeps, limits.chat, data, answers, relay, guard, flight)))
  // NASA's own numbers for a point and an hour, asked of JPL Horizons (horizons.ts). No model is called.
  app.all(HORIZONS_PATH, (c) => traced('POST /api/chat/horizons', c.req.raw, () => handleHorizons(c.req.raw, horizonsDeps, horizonsLimits, store.cache)))
  app.all('/api/ask', (c) => traced('POST /api/ask', c.req.raw, () => handleAsk(c.req.raw, handlerDeps, limits.ask, data, guard)))
  // Nothing else lives here. The load balancer never sends another path; someone on the service's own address might.
  app.all('*', () => reply({ error: 'not-found' }, 404))

  app.onError((error) => {
    console.error(error)
    return reply({ error: 'server' }, 500)
  })
  return app
}
