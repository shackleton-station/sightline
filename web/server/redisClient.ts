import { openRedis, type ReadEndpoint, type RedisConnection } from '../shared/redisClient'
import type { RedisCommands } from '../shared/redisStore'
import type { RoomRedis } from './rooms/redisRooms'

/**
 * The web server's use of Redis. The connection and the commands for rate limits and the cache
 * (`store`: the voice's and the rooms' limits, and kept voice clips) come from
 * `shared/redisClient.ts`, which the other services use too. Added here, on the same connection:
 * the commands for presenters' rooms (`rooms`). A connection that subscribes to a channel can run
 * no other command, so the first subscription opens a second connection, used only for listening.
 *
 * The co-pilot's event outbox and circuit breaker are not here: only the co-pilot service touches
 * those keys (copilot/redisClient.ts).
 */
export function connectRedis(host: string, port: number, read: ReadEndpoint | null = null): { store: RedisCommands; rooms: RoomRedis; connection: RedisConnection } {
  // `read`: the read endpoint of an instance with read replicas. Only cached values (kept voice
  // clips) are read from it; rooms, publish/subscribe and every write stay on the primary.
  const { client, store, complain, connection } = openRedis(host, port, read)

  const rooms: RoomRedis = {
    get: (key) => client.get(key),
    async set(key, value, ttlMs, only) {
      const written = await client.set(key, value, only === 'new' ? { PX: ttlMs, NX: true } : { PX: ttlMs, XX: true })
      return written !== null
    },
    async del(key) {
      await client.del(key)
    },
    async hSet(key, field, value) {
      await client.hSet(key, field, value)
    },
    hGetAll: (key) => client.hGetAll(key),
    async hDel(key, fields) {
      await client.hDel(key, fields)
    },
    async expire(key, ttlMs) {
      await client.pExpire(key, ttlMs)
    },
    async publish(channel, message) {
      await client.publish(channel, message)
    },
    subscribe(channel, heard) {
      const listener = client.duplicate()
      listener.on('error', complain)
      // Each time the connection is ready, first or again after a drop, ask for the channel. Asking twice is harmless.
      listener.on('ready', () => void listener.subscribe(channel, heard).catch(complain))
      void listener.connect().catch(() => {})
    },
  }
  return { store, rooms, connection }
}
