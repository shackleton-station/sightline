import type { RedisConnection } from './redisClient'
import type { SharedStore } from './store'

/**
 * Hit rates per kind of key, what single flight did, and where requests are being served from.
 *
 * HOW HITS ARE COUNTED. Each cache read adds one to a counter in Redis: a hash per UTC day,
 * `clps:stats:<yyyy-mm-dd>`, with a field per kind and outcome (`cache:copilot:hit`,
 * `cache:speak:miss`). The add is sent with the read and not waited for, so it costs the request
 * nothing and needs no CPU after the response (Cloud Run gives none). Every copy of every service
 * adds to the same hash, so the numbers are whole however many copies answered. A day's hash is
 * deleted eight days after its first count.
 *
 * The other ways, and why not. Memorystore's own `keyspace` metrics count every key lookup
 * together (the breaker's read, each lock), not per kind. A log line per read turned into a
 * log-based metric survives the instance being replaced, which these counters do not, but it is a
 * new metric, a minute behind, and read with a query. The counters are read with one `curl`.
 *
 * What they miss: reads made while Redis is away (the fallback is this copy's memory), and anything
 * counted before the instance was replaced. Read them before a replacement, and write them down.
 */
export interface KindCounts {
  hits: number
  misses: number
  /** Hits as a share of reads, 0 to 1, to three places; null when nothing was read. */
  hitRate: number | null
}

export interface DayReport {
  day: string
  /** Per kind of cache key: `copilot` (answers), `speak` (spoken audio). */
  cache: Record<string, KindCounts>
  /** Per kind, how many requests did what in a single flight: `led`, `waited`, `took-over` and so on (shared/singleFlight.ts). */
  flights: Record<string, Record<string, number>>
  /** Per kind, how many reads or writes meant for the Redis Cluster went to the ordinary instance instead (copilot/clusterCache.ts). */
  clusterFellBack: Record<string, number>
}

/** One day's counters, from their flat names (`cache:<kind>:hit`, `flight:<kind>:<how>`) into a report. */
export function dayReport(day: string, counts: Record<string, number>): DayReport {
  const cache: Record<string, KindCounts> = {}
  const flights: Record<string, Record<string, number>> = {}
  const clusterFellBack: Record<string, number> = {}
  for (const [name, count] of Object.entries(counts)) {
    const [group, kind, what] = name.split(':')
    if (!kind || !what) continue
    if (group === 'cache') {
      cache[kind] ??= { hits: 0, misses: 0, hitRate: null }
      if (what === 'hit') cache[kind].hits += count
      if (what === 'miss') cache[kind].misses += count
    } else if (group === 'flight') {
      flights[kind] ??= {}
      flights[kind][what] = count
    } else if (group === 'cluster' && what === 'fell-back') {
      clusterFellBack[kind] = count
    }
  }
  for (const kind of Object.values(cache)) {
    const reads = kind.hits + kind.misses
    kind.hitRate = reads > 0 ? Math.round((kind.hits / reads) * 1000) / 1000 : null
  }
  return { day, cache, flights, clusterFellBack }
}

/**
 * Where this copy's requests are being served from right now:
 * - `redis`: connected, and the last call was answered.
 * - `fallback`: connected as far as the client knows, but the last call failed or got no answer in
 *   time, and this copy's memory answered instead.
 * - `reconnecting`: the connection to the primary is down and being re-made; memory answers.
 * - `memory`: no Redis is configured.
 * It is one copy's view. Another copy may say something else for a few seconds.
 */
export type StoreState = 'redis' | 'fallback' | 'reconnecting' | 'memory'

export interface RedisStatus {
  state: StoreState
  /** The read endpoint's connection: `none` when there is none and cache reads go to the primary. */
  readEndpoint: 'ready' | 'reconnecting' | 'none'
  /** Connections made to the primary since this copy started: more than 1 means it has reconnected. */
  connections: number
  /** Calls that fell back to memory since this copy started. */
  fallbacks: number
}

export function redisStatus(store: SharedStore, connection: RedisConnection | undefined): RedisStatus {
  if (store.kind === 'memory') return { state: 'memory', readEndpoint: 'none', connections: 0, fallbacks: 0 }
  const health = store.health?.() ?? { fallbacks: 0, lastCallFellBack: false }
  return {
    state: connection && connection.primary() !== 'ready' ? 'reconnecting' : health.lastCallFellBack ? 'fallback' : 'redis',
    readEndpoint: connection?.readEndpoint() ?? 'none',
    connections: connection?.connections() ?? 0,
    fallbacks: health.fallbacks,
  }
}

/**
 * The same, asked properly: while the connection is up, Redis is asked once (one small read, at
 * most 300 ms) before answering. So a copy that has had no request since Redis came back does not
 * go on saying `fallback`, and a copy that has had no request since Redis stopped answering without
 * closing the connection (a frozen primary) does not go on saying `redis`. A copy that is
 * `reconnecting` or `memory` answers without asking: there is nothing to ask.
 *
 * Seen on a laptop before this asked in the `redis` case too: with the primary frozen for 15 s, the
 * web server and plans (which had requests) said `fallback`, and the co-pilot (which had none) said
 * `redis` the whole time.
 */
export async function checkedRedisStatus(store: SharedStore, connection: RedisConnection | undefined): Promise<RedisStatus> {
  const seen = redisStatus(store, connection)
  if ((seen.state !== 'fallback' && seen.state !== 'redis') || !store.cache.fresh) return seen
  await store.cache.fresh('status:probe').catch(() => null)
  return redisStatus(store, connection)
}

export interface CacheStatus {
  redis: RedisStatus
  /** Today and yesterday (UTC), today first. Empty when the counters cannot be read. */
  days: DayReport[]
  /** Memory in use on the primary and its limit, in bytes; null when it cannot be asked. */
  memory: { usedBytes: number; maxBytes: number } | null
  /** When this was read. The answer is reused for a few seconds, so many callers cost Redis one read. */
  readAt: string
}

const REUSE_MS = 5000

/**
 * Reads the report: two days of counters and the primary's memory, three small calls to Redis.
 * The answer is reused for 5 s per copy, so the address can be public without being a way to load
 * Redis. Never rejects: what cannot be read is left empty.
 */
export function cacheStatus(store: SharedStore, connection: RedisConnection | undefined, now: () => number = Date.now): () => Promise<CacheStatus> {
  let last: { at: number; status: CacheStatus } | null = null
  return async () => {
    if (last && now() - last.at < REUSE_MS) return { ...last.status, redis: await checkedRedisStatus(store, connection) }
    const [days, memory] = await Promise.all([
      store.counts ? store.counts.read(2).then((read) => read.map(({ day, counts }) => dayReport(day, counts))).catch(() => []) : Promise.resolve([]),
      connection ? Promise.race([connection.memory(), new Promise<null>((done) => setTimeout(() => done(null), 500))]).catch(() => null) : Promise.resolve(null),
    ])
    const status: CacheStatus = { redis: await checkedRedisStatus(store, connection), days, memory, readAt: new Date(now()).toISOString() }
    last = { at: now(), status }
    return status
  }
}
