import type { RedisConnection } from './redisClient'
import type { RedisCommands } from './redisStore'

/**
 * A stand-in for Redis, for tests only: no program imports this. It keeps what the real commands
 * keep (values with an expiry, sorted sets for the sliding window, hashes for counters) on a clock
 * the test controls, and can be made to fail the ways Redis fails:
 * - `down`: every call is refused at once, as when the connection has dropped;
 * - `hung`: no call is ever answered, as when a connection has gone quiet without closing;
 * - `replicaDown` / `replicaBehind`: the read endpoint refuses, or answers from before the last
 *   `syncReplica()`, as a replica that has not yet copied a write.
 */
export interface FakeRedis extends Required<RedisCommands> {
  down: boolean
  hung: boolean
  replicaDown: boolean
  /** While true the replica answers from its last copy; `syncReplica()` copies the primary to it. */
  replicaBehind: boolean
  syncReplica(): void
  /** The name of every command run, in order: `get`, `getFromReplica`, `setNew` and so on. */
  calls: string[]
  /** How many times a new connection was asked for. */
  reconnects: number
  /** Seconds until a value expires, or null if there is no such value. */
  ttl(key: string): number | null
  /** Every key that holds a live value. */
  keys(): string[]
}

export function fakeRedis(now: () => number = Date.now): FakeRedis {
  const values = new Map<string, { value: string; expires: number }>()
  let replica = new Map<string, { value: string; expires: number }>()
  const hashes = new Map<string, Record<string, string>>()
  const sets = new Map<string, number[]>()

  const live = (from: Map<string, { value: string; expires: number }>, key: string) => {
    const found = from.get(key)
    return found && found.expires > now() ? found.value : null
  }
  const run = <T>(name: string, work: () => T, onReplica = false): Promise<T> => {
    fake.calls.push(name)
    if (fake.hung) return new Promise<T>(() => {})
    if (onReplica ? fake.replicaDown : fake.down) return Promise.reject(new Error('connection refused'))
    return Promise.resolve(work())
  }

  const fake: FakeRedis = {
    down: false,
    hung: false,
    replicaDown: false,
    replicaBehind: false,
    calls: [],
    reconnects: 0,
    syncReplica() {
      replica = new Map(values)
    },
    ttl(key) {
      const found = values.get(key)
      return found && found.expires > now() ? Math.round((found.expires - now()) / 1000) : null
    },
    keys: () => [...values.keys()].filter((key) => live(values, key) !== null),
    slidingWindow: (key, nowMs, windowMs, limit, member) =>
      run('slidingWindow', () => {
        const recent = (sets.get(key) ?? []).filter((at) => at > nowMs - windowMs)
        if (recent.length >= limit) {
          sets.set(key, recent)
          // As the script: minus the wait until the oldest call that counts leaves the window.
          return -Math.max(1, recent[recent.length - limit] + windowMs - nowMs)
        }
        // As the script: with no member the call is only looked at, not counted.
        sets.set(key, member === '' ? recent : [...recent, nowMs])
        return 1
      }),
    get: (key) => run('get', () => live(values, key)),
    getFromReplica: (key) => run('getFromReplica', () => live(fake.replicaBehind ? replica : values, key), true),
    setEx: (key, ttlSeconds, value) => run('setEx', () => void values.set(key, { value, expires: now() + ttlSeconds * 1000 })),
    setNew: (key, value, ttlMs) =>
      run('setNew', () => {
        if (live(values, key) !== null) return false
        values.set(key, { value, expires: now() + ttlMs })
        return true
      }),
    deleteIf: (key, value) =>
      run('deleteIf', () => {
        if (live(values, key) !== value) return false
        values.delete(key)
        return true
      }),
    increment: (key, field) =>
      run('increment', () => {
        const hash = hashes.get(key) ?? {}
        hash[field] = String(Number(hash[field] ?? 0) + 1)
        hashes.set(key, hash)
      }),
    hGetAll: (key) => run('hGetAll', () => ({ ...hashes.get(key) })),
    reconnect() {
      fake.reconnects += 1
    },
  }
  return fake
}

/** A connection whose state a test sets. */
export function fakeConnection(state: { primary?: 'ready' | 'reconnecting'; readEndpoint?: 'ready' | 'reconnecting' | 'none'; connections?: number } = {}): RedisConnection {
  return {
    primary: () => state.primary ?? 'ready',
    readEndpoint: () => state.readEndpoint ?? 'none',
    connections: () => state.connections ?? 1,
    memory: async () => ({ usedBytes: 1_000_000, maxBytes: 0 }),
  }
}
