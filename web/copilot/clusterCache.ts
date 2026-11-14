import { createCluster } from 'redis'
import { jitteredSeconds } from '../shared/jitter'
import { reconnectDelayMs } from '../shared/redisClient'
import { kindOf, within } from '../shared/redisStore'
import type { Cache, Counts } from '../shared/store'

/**
 * The co-pilot's answer cache on a Redis Cluster, for the short window in which one exists
 * (docs/ARCHITECTURE_PHASE_4.md). Off unless CACHE_CLUSTER_HOST is set.
 *
 * WHAT A CLUSTER IS. Several Redis primaries ("shards"), each holding part of the keys. Every key
 * belongs to one of 16,384 hash slots (CRC16 of the key, modulo 16384), and each shard owns a range
 * of slots. A client that knows the slot map sends each command straight to the shard that owns
 * the key's slot. When it is wrong, because slots have moved since it read the map, the shard
 * answers with a redirect instead of a value:
 * - `MOVED <slot> <host:port>`: that slot lives there now, for good. The client reads the map
 *   again and sends the command there.
 * - `ASK <slot> <host:port>`: that slot is being moved and this key has already gone. The client
 *   sends this one command there, after an `ASKING`, and keeps its map.
 * A client that does not know about clusters just gets the error. The library's cluster client
 * (`createCluster`, in the `redis` package this repository already uses) follows both.
 *
 * WHY ONLY THIS. The answer cache is the one thing here that can lose everything and cost only
 * model calls: a miss recomputes. Rate limits, the circuit breaker, the outbox, the single-flight
 * lock, the counters and presenters' rooms stay on the ordinary instance. Each answer is one key
 * with one command (GET, or SET with an expiry), so nothing needs two keys in one slot.
 *
 * WHEN IT FAILS. A read or write that fails, or gets no answer in 300 ms, goes to the ordinary
 * instance's cache instead (`next`), which falls back to this copy's memory in turn. So a cluster
 * that is being created, resized or deleted costs at most some misses.
 */
export interface ClusterCommands {
  get(key: string): Promise<string | null>
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>
}

/** What the connection to the cluster is doing: `ready` once it has read the slot map. */
export type ClusterState = 'ready' | 'connecting'

/**
 * Connects to the cluster through its discovery endpoint, which answers with the slot map and the
 * address of every shard. The first connection is tried again until it works (the service may
 * start before the cluster is ready); after that the library reconnects each shard by itself and
 * reads the map again whenever a shard redirects it.
 */
export function openCluster(host: string, port: number): { commands: ClusterCommands; state: () => ClusterState } {
  const socket = { connectTimeout: 2000, reconnectStrategy: (retries: number) => reconnectDelayMs(retries) }
  const cluster = createCluster({ rootNodes: [{ socket: { host, port, ...socket } }], defaults: { socket, disableOfflineQueue: true } })
  let lastComplaint = 0
  const complain = (error: unknown) => {
    if (Date.now() - lastComplaint > 60_000) {
      lastComplaint = Date.now()
      console.warn('Redis Cluster connection:', error instanceof Error ? error.message : error)
    }
  }
  cluster.on('error', complain)
  let ready = false
  /** Whether the map the client holds gives every one of the 16,384 slots an owner. */
  const covered = () => {
    let owned = 0
    for (const shard of cluster.slots) if (shard) owned += 1
    return owned === SLOTS
  }
  /** Reads the slot map again, at most once every 2 s however many commands ask for it. */
  let lastRefresh = 0
  const refresh = (): Promise<unknown> => {
    if (Date.now() - lastRefresh < 2000) return Promise.resolve()
    lastRefresh = Date.now()
    return cluster._slots.rediscover().catch(complain)
  }
  /**
   * Ready once the map is whole. A cluster that is still being put together answers with a map in
   * which some slots have no owner (seen on a laptop: the service started before the nodes had been
   * joined, and the client held a map of one shard). Then the map is read again until it is whole.
   */
  const settle = (attempt: number): void => {
    if (covered()) {
      ready = true
      console.log(`Redis Cluster connected: ${cluster.masters.length} shards`)
      return
    }
    setTimeout(() => void refresh().then(() => settle(attempt + 1)), reconnectDelayMs(attempt)).unref()
  }
  const connect = (attempt: number): void => {
    cluster
      .connect()
      .then(() => settle(0))
      .catch((error: unknown) => {
        complain(error)
        setTimeout(() => connect(attempt + 1), reconnectDelayMs(attempt)).unref()
      })
  }
  connect(0)

  /**
   * One command. The library follows MOVED and ASK by itself. Anything else that fails (a shard
   * that went away, a slot the map gives no owner) is passed on to the caller, which falls back,
   * and the map is read again in the background so the next command has a fresh one.
   */
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    if (!ready) return Promise.reject(new Error('the cluster is not connected yet'))
    return work().catch((error: unknown) => {
      void refresh()
      throw error
    })
  }
  return {
    commands: {
      get: (key) => run(() => cluster.get(key)),
      setEx: (key, ttlSeconds, value) => run(async () => void (await cluster.set(key, value, { EX: ttlSeconds }))),
    },
    state: () => (ready ? 'ready' : 'connecting'),
  }
}

const SLOTS = 16_384

const PREFIX = 'clps:cache:'

/**
 * A cache that tries the cluster first and `next` (the ordinary instance's cache) when the cluster
 * fails. A value the cluster does not have is a miss: `next` is asked only after a failure. Hits
 * and misses are counted under the same names as the ordinary cache's, and each failure as
 * `cluster:<kind>:fell-back`.
 */
export function clusterCache(cluster: ClusterCommands, next: Cache, counts?: Counts, random: () => number = Math.random): Cache {
  let lastComplaint = Number.NEGATIVE_INFINITY
  const failed = (key: string, error: unknown) => {
    counts?.add(`cluster:${kindOf(key)}:fell-back`)
    if (Date.now() - lastComplaint > 60_000) {
      lastComplaint = Date.now()
      console.warn('Redis Cluster unavailable; using the ordinary instance for answers for now:', error instanceof Error ? error.message : error)
    }
  }
  return {
    async get(key) {
      try {
        const value = await within(cluster.get(PREFIX + key))
        counts?.add(`cache:${kindOf(key)}:${value === null ? 'miss' : 'hit'}`)
        return value
      } catch (error) {
        failed(key, error)
        return next.get(key)
      }
    },
    async fresh(key) {
      try {
        // The cluster client reads from each shard's primary, so this is already the latest.
        return await within(cluster.get(PREFIX + key))
      } catch (error) {
        failed(key, error)
        return next.fresh ? next.fresh(key) : next.get(key)
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await within(cluster.setEx(PREFIX + key, jitteredSeconds(ttlSeconds, random), value))
      } catch (error) {
        failed(key, error)
        await next.set(key, value, ttlSeconds)
      }
    },
  }
}
