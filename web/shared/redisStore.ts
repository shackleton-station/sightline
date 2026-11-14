import { randomUUID } from 'node:crypto'
import { jitteredSeconds } from './jitter'
import type { Attempt, Counts, Locks, SharedStore } from './store'

/**
 * The Redis commands the store uses. Tests pass a fake; `redisClient.ts` passes the real ones.
 *
 * The first three are all it needs. The rest are optional, and each switches something on:
 * `getFromReplica` reads the cache from the read endpoint, `setNew` and `deleteIf` give locks,
 * `increment` and `hGetAll` give the shared counters.
 */
export interface RedisCommands {
  /** Runs the sliding-window script below, on the primary. Returns 1 if the call is allowed; after a refusal, 0 or minus the wait in ms. */
  slidingWindow(key: string, nowMs: number, windowMs: number, limit: number, member: string): Promise<number>
  /** GET on the primary. */
  get(key: string): Promise<string | null>
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>
  /** GET on the read endpoint (a replica, which may be a few seconds behind). Only when one is configured. */
  getFromReplica?(key: string): Promise<string | null>
  /** SET key value NX PX ttl: written only if the key does not exist. True if it was written. */
  setNew?(key: string, value: string, ttlMs: number): Promise<boolean>
  /** Deletes the key only if it still holds `value` (the script below). True if it was deleted. */
  deleteIf?(key: string, value: string): Promise<boolean>
  /** HINCRBY key field 1, and an expiry on the key the first time the field is counted. */
  increment?(key: string, field: string, ttlSeconds: number): Promise<void>
  hGetAll?(key: string): Promise<Record<string, string>>
  /** Drops the connection to the primary and makes a new one. Asked for after several calls in a row got no answer. */
  reconnect?(): void
}

/**
 * A sliding-window rate limit as one atomic step. Each key is a sorted set of the times of recent
 * calls. The script forgets the ones older than the window, refuses if `limit` remain, and
 * otherwise records this call. Running as a script means two copies of the server asking at the
 * same instant can't both slip under the limit.
 *
 * A refusal answers minus the wait until the oldest call leaves the window, in ms, so the caller
 * can say when to try again (a `Retry-After` header). Code from before this change compared the
 * answer with 1 only, so it reads a refusal the same way. The script is sent whole with each call
 * (EVAL), so two services running two versions of it never mix them up.
 *
 * With no name for the call (ARGV[4] is "") the script only looks: it answers as it would, and
 * records nothing. A caller with several limits looks at all of them first, so a call that one of
 * them refuses is counted against none (copilot/busy.ts).
 *
 * KEYS[1] the set · ARGV[1] now (ms) · ARGV[2] window (ms) · ARGV[3] limit · ARGV[4] a unique name for this call, or "" to look without counting
 */
export const SLIDING_WINDOW_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], count - tonumber(ARGV[3]), count - tonumber(ARGV[3]), 'WITHSCORES')
  local wait = 1
  if oldest[2] then wait = math.max(1, tonumber(oldest[2]) + tonumber(ARGV[2]) - tonumber(ARGV[1])) end
  return -wait
end
if ARGV[4] ~= '' then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[1]), ARGV[4])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 1`

/**
 * Releases a lock only if the caller still holds it: delete the key if its value is the caller's
 * token. A plain DEL could delete a lock that expired and was taken by someone else in between.
 * The compare and the delete have to be one step, so they are a script.
 *
 * KEYS[1] the lock · ARGV[1] the token
 */
export const DELETE_IF_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`

/** How long to wait for Redis before treating it as down for this request. */
const PATIENCE_MS = 300
const PREFIX = 'clps:'
/** After a call to Redis gets no answer in time, how long the store answers from memory without asking Redis again. */
export const REST_MS = 2000
/** Calls in a row with no answer in time (each followed by a rest) before a new connection is asked for. */
const SLOW_CALLS_BEFORE_RECONNECT = 3
/** How long a day's counters are kept. */
const COUNTS_TTL_S = 8 * 24 * 60 * 60

/** A call to Redis that got no answer in time, as opposed to one refused at once. */
export class SlowRedis extends Error {
  constructor() {
    super('Redis took too long')
  }
}
/** A call not made, because the store is leaving Redis alone for a moment after a slow one. */
class Resting extends Error {
  constructor() {
    super('Redis is being left alone for a moment')
  }
}

/** The result of a Redis command, or a failure if it doesn't come soon. */
export function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SlowRedis()), PATIENCE_MS)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** The UTC day of a time, `yyyy-mm-dd`: the name of that day's counters. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** A cache key's kind: what comes before its first colon (`copilot`, `speak`). */
export function kindOf(key: string): string {
  const colon = key.indexOf(':')
  return colon > 0 ? key.slice(0, colon) : 'other'
}

/**
 * The store on Redis, shared by every copy of the server. If Redis is slow or down, each call
 * falls back to `fallback` (this copy's memory) instead of failing: limits become per-copy again
 * and answers aren't shared, but visitors notice nothing.
 *
 * WHICH CONNECTION. Everything goes to the primary, except reading a cached value, which goes to
 * the read endpoint when there is one (`redis.getFromReplica`). A replica copies from the primary a
 * moment later ("the replica can lag by a few seconds", Google's page on read replicas), so:
 * - a cache read may miss an entry written a moment ago. That is harmless: a miss recomputes, and an
 *   entry is keyed by the code and data that made it, so a replica can lack an answer but never
 *   hold a wrong one;
 * - a rate limit is never read there. A count that is a moment old lets extra calls through, and
 *   the limit's script writes as well as reads. Limits, locks and counters stay on the primary.
 * If the read endpoint fails, the read is tried on the primary. If that fails too, this copy's
 * memory answers, which is a miss unless this copy kept the value itself.
 *
 * WHEN REDIS HANGS. A connection that drops fails every call at once, and the fallback answers. A
 * connection that goes quiet without dropping would cost each call its 300 ms of patience. So after
 * one call gets no answer in time, the store rests: for the next 2 s it answers from memory
 * without asking, then tries again. One request in two seconds pays the wait, not every request.
 */
export function redisStore(redis: RedisCommands, fallback: SharedStore, now: () => number = Date.now, random: () => number = Math.random): SharedStore {
  let lastComplaint = Number.NEGATIVE_INFINITY
  let lastReplicaComplaint = Number.NEGATIVE_INFINITY
  let lastFallbackAt: number | null = null
  let lastAnswerAt: number | null = null
  let fallbacks = 0
  let lastCallFellBack = false
  let restUntil = 0
  let replicaRestUntil = 0
  let slowInARow = 0

  const degraded = (error: unknown) => {
    lastFallbackAt = now()
    lastCallFellBack = true
    fallbacks += 1
    if (error instanceof SlowRedis) {
      // Calls made together time out together: they count as one.
      if (now() >= restUntil) slowInARow += 1
      restUntil = now() + REST_MS
      // A connection that has gone quiet without closing never recovers by itself: ask for a new one.
      if (slowInARow >= SLOW_CALLS_BEFORE_RECONNECT) {
        slowInARow = 0
        redis.reconnect?.()
      }
    }
    // Once a minute is enough to know; a line per request would bury everything else.
    if (!(error instanceof Resting) && now() - lastComplaint > 60_000) {
      lastComplaint = now()
      console.warn('Redis unavailable; using this copy\'s memory for now:', error instanceof Error ? error.message : error)
    }
  }
  /** One call to the primary: bounded in time, not made while resting, and noted when it is answered. */
  const ask = async <T>(work: () => Promise<T>): Promise<T> => {
    if (now() < restUntil) throw new Resting()
    const answer = await within(work())
    lastAnswerAt = now()
    lastCallFellBack = false
    slowInARow = 0
    return answer
  }
  const replicaFailed = (error: unknown) => {
    replicaRestUntil = now() + REST_MS
    if (now() - lastReplicaComplaint > 60_000) {
      lastReplicaComplaint = now()
      console.warn('Redis read endpoint unavailable; reading the cache from the primary for now:', error instanceof Error ? error.message : error)
    }
  }

  const { increment, hGetAll, setNew, deleteIf } = redis
  const counts: Counts | undefined =
    increment && hGetAll
      ? {
          add(name) {
            // Sent and not waited for: the request carries on, and a count that is lost is only a count.
            if (now() < restUntil) return
            void increment(`${PREFIX}stats:${dayOf(now())}`, name, COUNTS_TTL_S).catch(() => {})
          },
          async read(days) {
            const names = Array.from({ length: days }, (_, back) => dayOf(now() - back * 24 * 60 * 60_000))
            const read = await Promise.all(names.map((day) => within(hGetAll(`${PREFIX}stats:${day}`))))
            return names.map((day, n) => ({ day, counts: Object.fromEntries(Object.entries(read[n]).map(([name, count]) => [name, Number(count)])) }))
          },
        }
      : undefined

  const locks: Locks | undefined =
    setNew && deleteIf
      ? {
          async acquire(name, ttlMs) {
            const token = randomUUID()
            return (await ask(() => setNew(`${PREFIX}lock:${name}`, token, ttlMs))) ? token : null
          },
          async release(name, token) {
            await ask(() => deleteIf(`${PREFIX}lock:${name}`, token)).catch(() => {})
          },
        }
      : undefined

  return {
    kind: 'redis',
    limiter(name, limit, windowMs) {
      const local = fallback.limiter(name, limit, windowMs)
      // With a member the call is counted; with none ("") the script only looks.
      const asked = async (key: string, count: boolean): Promise<Attempt> => {
        try {
          const answer = await ask(() => redis.slidingWindow(`${PREFIX}limit:${name}:${key}`, now(), windowMs, limit, count ? randomUUID() : ''))
          // 1 is allowed. A refusal is minus the wait; 0 from a script with no wait means a whole window.
          return answer === 1 ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs: answer < 0 ? -answer : windowMs }
        } catch (error) {
          degraded(error)
          return count ? local.attempt(key) : local.peek(key)
        }
      }
      const attempt = (key: string) => asked(key, true)
      return { attempt, take: async (key) => (await attempt(key)).allowed, peek: (key) => asked(key, false) }
    },
    cache: {
      async get(key) {
        const stored = `${PREFIX}cache:${key}`
        try {
          let value: string | null
          const replica = redis.getFromReplica
          if (replica && now() >= replicaRestUntil) {
            try {
              value = await within(replica(stored))
            } catch (error) {
              // The read endpoint failing is not the store failing: the primary is asked instead.
              replicaFailed(error)
              value = await ask(() => redis.get(stored))
            }
          } else {
            value = await ask(() => redis.get(stored))
          }
          counts?.add(`cache:${kindOf(key)}:${value === null ? 'miss' : 'hit'}`)
          return value
        } catch (error) {
          degraded(error)
          return fallback.cache.get(key)
        }
      },
      async fresh(key) {
        try {
          return await ask(() => redis.get(`${PREFIX}cache:${key}`))
        } catch (error) {
          degraded(error)
          return fallback.cache.get(key)
        }
      },
      async set(key, value, ttlSeconds) {
        try {
          // Its own expiry, within 10% of what was asked for, so entries written together do not expire together.
          await ask(() => redis.setEx(`${PREFIX}cache:${key}`, jitteredSeconds(ttlSeconds, random), value))
        } catch (error) {
          degraded(error)
          await fallback.cache.set(key, value, ttlSeconds)
        }
      },
    },
    locks,
    counts,
    health: () => ({ lastFallbackAt, lastAnswerAt, fallbacks, lastCallFellBack }),
  }
}
