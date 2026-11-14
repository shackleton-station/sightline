import { jitteredSeconds } from './jitter'
import { RateLimit } from './rateLimit'

/** Whether a call was allowed, and after a refusal how long until the same key may call again. */
export interface Attempt {
  allowed: boolean
  /** 0 when allowed. After a refusal: the wait, in ms, a `Retry-After` header passes on. */
  retryAfterMs: number
}

/** Allows a number of calls per key in a sliding window of time. */
export interface Limiter {
  /** True if this call is allowed; it then counts against the key. */
  take(key: string): Promise<boolean>
  /** The same as `take`, and says how long to wait after a refusal. */
  attempt(key: string): Promise<Attempt>
  /** What `attempt` would answer now, without counting the call against the key. */
  peek(key: string): Promise<Attempt>
}

/**
 * Short-lived values, looked up by key. A key starts with its kind and a colon (`copilot:`,
 * `speak:`), which is how hits and misses are counted per kind.
 */
export interface Cache {
  /** The value, or null. On Redis with a read endpoint this may be a moment behind the last write, and it is counted as a hit or a miss. */
  get(key: string): Promise<string | null>
  /** Keeps the value for `ttlSeconds` plus or minus 10%, chosen for this write (shared/jitter.ts). */
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  /**
   * The value as the primary has it now: what a request reads when it must see a write another
   * request has just made (shared/singleFlight.ts). Not counted as a hit or a miss. A cache with
   * one place to read from leaves this out, and `get` is used.
   */
  fresh?(key: string): Promise<string | null>
}

/** A short lock that every copy of every service sees, so one of them does a piece of work and the others wait for it. */
export interface Locks {
  /** Takes the lock if nobody holds it. The answer is a token to release it with, or null if it is held. Rejects if the lock cannot be asked for. */
  acquire(name: string, ttlMs: number): Promise<string | null>
  /** Gives the lock up, only if this token still holds it. Never rejects: a lock that is not released expires. */
  release(name: string, token: string): Promise<void>
}

/** Counters shared by every copy, kept per day (UTC): cache hits and misses, and what single flight did. */
export interface Counts {
  /** Adds one to today's counter of that name. Never waits and never rejects. */
  add(name: string): void
  /** The counters of the last `days` days, today first: `{ day: 'yyyy-mm-dd', counts: { name: n } }`. */
  read(days: number): Promise<{ day: string; counts: Record<string, number> }[]>
}

/** How the store's last calls to Redis went, for a status that says truthfully where requests are served from. */
export interface StoreHealth {
  /** When a call last fell back to this copy's memory (ms since the epoch), or null if none has. */
  lastFallbackAt: number | null
  /** When a call was last answered by Redis, or null. */
  lastAnswerAt: number | null
  /** Calls that fell back to memory since this copy started. */
  fallbacks: number
  /** Whether the latest call to Redis fell back to memory. */
  lastCallFellBack: boolean
}

/**
 * What the server remembers between requests: rate-limit counts and cached answers.
 * In memory, each copy of the server has its own (fine for one copy and for tests). On Redis,
 * every copy shares one, so three copies enforce one limit and reuse one another's answers.
 */
export interface SharedStore {
  kind: 'redis' | 'memory'
  /** A limiter of `limit` calls per `windowMs`. The name keeps different limits apart. */
  limiter(name: string, limit: number, windowMs: number): Limiter
  cache: Cache
  /** Locks every copy sees. Only on Redis: in memory there is nobody to share a lock with. */
  locks?: Locks
  /** Shared counters. Only on Redis. */
  counts?: Counts
  /** Only on Redis: whether its last calls were answered. */
  health?(): StoreHealth
}

const MAX_CACHED = 500

/** The store kept in this process's memory. `random` picks each cached value's expiry within 10% of what was asked for. */
export function memoryStore(now: () => number = Date.now, random: () => number = Math.random): SharedStore {
  const values = new Map<string, { value: string; expires: number }>()
  return {
    kind: 'memory',
    limiter(_name, limit, windowMs) {
      const counts = new RateLimit(limit, windowMs, now)
      return { take: (key) => Promise.resolve(counts.take(key)), attempt: (key) => Promise.resolve(counts.attempt(key)), peek: (key) => Promise.resolve(counts.peek(key)) }
    },
    cache: {
      get(key) {
        const found = values.get(key)
        if (found && found.expires <= now()) values.delete(key)
        return Promise.resolve(found && found.expires > now() ? found.value : null)
      },
      set(key, value, ttlSeconds) {
        values.delete(key)
        values.set(key, { value, expires: now() + jitteredSeconds(ttlSeconds, random) * 1000 })
        // Oldest out first, so the memory this can use has a ceiling.
        if (values.size > MAX_CACHED) values.delete(values.keys().next().value as string)
        return Promise.resolve()
      },
    },
  }
}
