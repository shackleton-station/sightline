import { openRedis, type ReadEndpoint } from '../shared/redisClient'
import { type BreakerRedis, COMPARE_AND_SET_SCRIPT } from './breaker'
import type { OutboxRedis } from './outbox'

type Client = ReturnType<typeof openRedis>['client']

/**
 * The commands the co-pilot keeps in Redis besides rate limits and the cache: the event outbox and
 * the circuit breaker's state, on the connection `shared/redisClient.ts` opens. Only this service
 * touches those keys.
 */
export function copilotCommands(client: Client): { outbox: OutboxRedis; breaker: BreakerRedis } {
  const outbox: OutboxRedis = {
    async hSet(key, field, value) {
      await client.hSet(key, field, value)
    },
    hGetAll: (key) => client.hGetAll(key),
    async hDel(key, fields) {
      await client.hDel(key, fields)
    },
    async setNew(key, value, ttlMs) {
      return (await client.set(key, value, { PX: ttlMs, NX: true })) !== null
    },
  }
  const breaker: BreakerRedis = {
    get: (key) => client.get(key),
    async compareAndSet(key, expected, next, ttlMs) {
      const written = await client.eval(COMPARE_AND_SET_SCRIPT, { keys: [key], arguments: [expected ?? '', next, String(ttlMs)] })
      return Number(written) === 1
    },
  }
  return { outbox, breaker }
}

/**
 * The co-pilot service's Redis. The connection to the primary carries rate limits, the outbox, the
 * breaker, locks, counters and every write. With `read` (an instance with read replicas), a second
 * connection to the read endpoint is asked for kept answers only (shared/redisClient.ts).
 */
export function connectCopilotRedis(host: string, port: number, read: ReadEndpoint | null = null) {
  const { client, store, connection } = openRedis(host, port, read)
  return { client, store, connection, ...copilotCommands(client) }
}
