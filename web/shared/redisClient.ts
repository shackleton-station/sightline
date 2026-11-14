import { createClient } from 'redis'
import { DELETE_IF_SCRIPT, type RedisCommands, SLIDING_WINDOW_SCRIPT } from './redisStore'

/** Where a second, read-only connection goes: the instance's read endpoint, when it has read replicas. */
export interface ReadEndpoint {
  host: string
  port: number
}

/** What the connections are doing right now, for a status that says so truthfully. */
export interface RedisConnection {
  /** `ready`: connected. `reconnecting`: the connection is down and being re-made; calls fail at once and memory answers. */
  primary(): 'ready' | 'reconnecting'
  /** The same for the read endpoint; `none` when there is none and every read goes to the primary. */
  readEndpoint(): 'ready' | 'reconnecting' | 'none'
  /** How many times the connection to the primary has been made since this copy started. 1 is the first. */
  connections(): number
  /** Memory in use on the primary, from INFO: bytes used, and the instance's limit (0: none set). */
  memory(): Promise<{ usedBytes: number; maxBytes: number }>
}

/**
 * How long to wait before reconnecting, for the nth try in a row (0 is the first). It doubles from
 * 200 ms up to 2 s, and half of each wait is random, so copies that lost the connection at the same
 * moment (a failover drops every connection at once) do not all come back at the same moment.
 *
 * The ceiling was 10 s. A failover "usually completes in under 30 seconds" (Google's page on read
 * replicas), and a reconnect that waits up to 10 s more keeps a copy on its memory fallback for
 * that long after Redis is back. A try costs one TCP connect, so 2 s is cheap.
 */
export function reconnectDelayMs(retries: number, random: () => number = Math.random): number {
  const ceiling = Math.min(200 * 2 ** Math.min(retries, 10), 2000)
  return Math.round(ceiling / 2 + (ceiling / 2) * random())
}

/** `used_memory` and `maxmemory` out of the text INFO answers with. */
export function readMemory(info: string): { usedBytes: number; maxBytes: number } {
  const field = (name: string) => Number(new RegExp(`^${name}:(\\d+)`, 'm').exec(info)?.[1] ?? 0)
  return { usedBytes: field('used_memory'), maxBytes: field('maxmemory') }
}

/**
 * Connects to Redis (Memorystore, on the project's private network). The connection is made in
 * the background and re-made when it drops; while it is down, commands fail at once and the store
 * falls back to memory, so a request never waits on a reconnect.
 *
 * TWO CONNECTIONS, when the instance has read replicas. The primary takes every write, every
 * script (rate limits, the circuit breaker, releasing a lock), the outbox, rooms and
 * publish/subscribe. The read endpoint, which Memorystore spreads over the replicas, is asked only
 * for cached values (`store.getFromReplica`). Without `read`, there is one connection and reads go
 * to the primary, exactly as before read replicas existed. Why limits never read from a replica is
 * in `redisStore.ts`.
 *
 * AFTER A FAILOVER every connection to the primary endpoint is dropped, and some to the read
 * endpoint. Each connection here notices (the socket closes), fails its commands at once
 * (`disableOfflineQueue`), and tries again after `reconnectDelayMs`, giving a try 2 s to connect.
 * A connection that goes quiet without closing is the other case: after three calls in a row get
 * no answer, the store asks for a new connection (`store.reconnect`).
 *
 * Returns the commands for rate limits and the cache (`store`), which every service that answers
 * visitors needs; the connection itself, for a service that keeps more in Redis (the web server
 * adds presenters' rooms in `server/redisClient.ts`, the co-pilot its outbox and breaker in
 * `copilot/redisClient.ts`); and `connection`, which says what the connections are doing.
 * `complain` logs a connection error at most once a minute.
 */
export function openRedis(host: string, port: number, read: ReadEndpoint | null = null) {
  const options = (to: ReadEndpoint) => ({
    socket: { host: to.host, port: to.port, connectTimeout: 2000, reconnectStrategy: (retries: number) => reconnectDelayMs(retries) },
    disableOfflineQueue: true,
  })
  const client = createClient(options({ host, port }))
  let lastComplaint = 0
  const complain = (error: Error) => {
    if (Date.now() - lastComplaint > 60_000) {
      lastComplaint = Date.now()
      console.warn('Redis connection:', error.message)
    }
  }
  let connections = 0
  client.on('error', complain)
  client.on('ready', () => {
    connections += 1
    console.log(connections === 1 ? 'Redis connected' : `Redis connected again (connection ${connections})`)
  })
  void client.connect().catch(() => {})

  const reader = read ? createClient(options(read)) : null
  if (reader) {
    let lastReaderComplaint = 0
    reader.on('error', (error: Error) => {
      if (Date.now() - lastReaderComplaint > 60_000) {
        lastReaderComplaint = Date.now()
        console.warn('Redis read endpoint connection:', error.message)
      }
    })
    reader.on('ready', () => console.log('Redis read endpoint connected'))
    void reader.connect().catch(() => {})
  }

  const store: RedisCommands = {
    async slidingWindow(key, nowMs, windowMs, limit, member) {
      const result = await client.eval(SLIDING_WINDOW_SCRIPT, { keys: [key], arguments: [String(nowMs), String(windowMs), String(limit), member] })
      return Number(result)
    },
    get: (key) => client.get(key),
    async setEx(key, ttlSeconds, value) {
      await client.set(key, value, { EX: ttlSeconds })
    },
    ...(reader ? { getFromReplica: (key: string) => reader.get(key) } : {}),
    async setNew(key, value, ttlMs) {
      return (await client.set(key, value, { PX: ttlMs, NX: true })) !== null
    },
    async deleteIf(key, value) {
      return Number(await client.eval(DELETE_IF_SCRIPT, { keys: [key], arguments: [value] })) === 1
    },
    async increment(key, field, ttlSeconds) {
      // The expiry is set once, when a counter is first counted, so a day's counters go a week after the day.
      if ((await client.hIncrBy(key, field, 1)) === 1) await client.expire(key, ttlSeconds)
    },
    hGetAll: (key) => client.hGetAll(key),
    reconnect() {
      if (!client.isReady) return
      console.warn('Redis: several calls in a row got no answer; opening a new connection')
      client.destroy()
      void client.connect().catch(() => {})
    },
  }

  const connection: RedisConnection = {
    primary: () => (client.isReady ? 'ready' : 'reconnecting'),
    readEndpoint: () => (reader ? (reader.isReady ? 'ready' : 'reconnecting') : 'none'),
    connections: () => connections,
    memory: async () => readMemory(await client.info('memory')),
  }
  return { client, store, complain, connection }
}
