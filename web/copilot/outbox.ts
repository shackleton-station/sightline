import type { EventSink } from '../shared/events'
import { within } from '../shared/redisStore'

/**
 * The outbox: how an event gets from the co-pilot to the queue without being lost on the way.
 *
 * THE PROBLEM. Publishing straight to the queue is one try. If the queue refuses it, or the publish
 * is slow and Cloud Run takes the CPU away when the response ends, or the copy is stopped, the
 * event is gone: it lived only in this process's memory.
 *
 * THE PATTERN. First write the event somewhere that outlives the request and the copy (the outbox).
 * Then a relay publishes it and, only once the queue has it, removes it. A relay that crashes
 * between the two publishes the same event again later, so delivery is "at least once", and the
 * reader must count an event once however often it arrives (`events-worker`, by the event's id).
 *
 * WHERE IT LIVES. In Redis, as one hash. The co-pilot already calls Redis five times a question
 * (four rate limits and the answer cache), on the private network, in about a millisecond each. So
 * the outbox adds one such call before the answer and one after, and no new service, permission or
 * bill. Firestore would be safer (it keeps data on disk in several places) and slower: the two
 * traces that hold a write to it from this server show 166 ms and 191 ms. The numbers and the trade
 * are in `docs/decisions/0002-events-worker.md`.
 *
 * WHAT IT DOES NOT SURVIVE. Redis itself restarting while an event waits (this Redis keeps nothing
 * on disk), and Redis being unreachable at the moment of the write: then the event is held in this
 * copy's memory and published as before the outbox existed.
 *
 * WHEN THE RELAY RUNS. Only when this copy has CPU, which on Cloud Run means while it is handling a
 * request or shutting down:
 *   1. straight after the write, inside the same request (the usual case: about 50 ms);
 *   2. on a timer, which only ticks while some request is being handled, and then picks up events
 *      left behind by any copy;
 *   3. when the copy is told to stop.
 * So an event whose first publish failed is late, not lost: it goes out with the next request this
 * copy or another handles, or when a copy stops.
 */
export interface OutboxEntry {
  id: string
  event: Record<string, unknown>
  attributes: Record<string, string>
  /** When it was written, in ms. The relay leaves fresh entries to the request that wrote them. */
  queuedAt: number
}

export interface Outbox {
  kind: 'redis' | 'memory'
  /** Stores an entry. Resolves only once it is stored; never rejects. */
  put(entry: OutboxEntry): Promise<void>
  /** Marks an entry sent by removing it. Never rejects: an entry that stays is simply sent again. */
  remove(id: string): Promise<void>
  /** Every entry still waiting. */
  waiting(): Promise<OutboxEntry[]>
  /** True if this copy may sweep now: at most one copy sweeps at a time, so most events are not sent twice. */
  claimSweep(forMs: number): Promise<boolean>
}

/** The outbox in this process's memory: for tests, for one machine, and as the fallback when Redis is away. */
export function memoryOutbox(): Outbox {
  const entries = new Map<string, OutboxEntry>()
  return {
    kind: 'memory',
    put(entry) {
      entries.set(entry.id, entry)
      return Promise.resolve()
    },
    remove(id) {
      entries.delete(id)
      return Promise.resolve()
    },
    waiting: () => Promise.resolve([...entries.values()]),
    claimSweep: () => Promise.resolve(true),
  }
}

/** The Redis commands the outbox uses. Tests pass a fake; `redisClient.ts` passes the real ones. */
export interface OutboxRedis {
  hSet(key: string, field: string, value: string): Promise<void>
  hGetAll(key: string): Promise<Record<string, string>>
  hDel(key: string, fields: string[]): Promise<void>
  /** SET with an expiry, only if the key is new (NX). True if it was written. */
  setNew(key: string, value: string, ttlMs: number): Promise<boolean>
}

/**
 * One hash, a field per waiting event. It has no expiry on purpose: this Redis only ever evicts
 * keys that have one (`volatile-lru`, infra/data.tf), so a full cache cannot push an event out.
 */
const EVENTS = 'clps:outbox:events'
const SWEEPING = 'clps:outbox:sweeping'

function readEntry(text: string): OutboxEntry | null {
  try {
    const entry = JSON.parse(text) as Partial<OutboxEntry>
    return typeof entry.id === 'string' && typeof entry.queuedAt === 'number' && typeof entry.event === 'object' && entry.event !== null ? { id: entry.id, event: entry.event, attributes: entry.attributes ?? {}, queuedAt: entry.queuedAt } : null
  } catch {
    return null
  }
}

/** The outbox on Redis, shared by every copy of the server. If Redis is slow or down, entries are held in `fallback`. */
export function redisOutbox(redis: OutboxRedis, fallback: Outbox = memoryOutbox()): Outbox {
  return {
    kind: 'redis',
    async put(entry) {
      try {
        await within(redis.hSet(EVENTS, entry.id, JSON.stringify(entry)))
      } catch {
        await fallback.put(entry)
      }
    },
    async remove(id) {
      await fallback.remove(id)
      await within(redis.hDel(EVENTS, [id])).catch(() => {})
    },
    async waiting() {
      const held = await fallback.waiting()
      try {
        const stored = await within(redis.hGetAll(EVENTS))
        return [...held, ...Object.values(stored).flatMap((text) => readEntry(text) ?? [])]
      } catch {
        return held
      }
    },
    async claimSweep(forMs) {
      try {
        return await within(redis.setNew(SWEEPING, '1', forMs))
      } catch {
        // Redis is away, so there is nothing shared to sweep: only this copy's own held entries.
        return true
      }
    },
  }
}

/** Leaves an entry this long to the request that wrote it, which is publishing it right now. */
const GRACE_MS = 15_000
/** How often the timer looks for entries left behind. */
const SWEEP_EVERY_MS = 20_000
const SWEEP_CLAIM_MS = 10_000
const MAX_PER_SWEEP = 50
/** After a sweep that the queue refused, the wait before the next one doubles, up to this. */
const MAX_BACKOFF_MS = 5 * 60_000
/** An event the queue has not taken in three days is given up on, loudly. The reader's "seen" records last longer than this (shared/stats.ts). */
const GIVE_UP_MS = 3 * 24 * 60 * 60_000

export interface Relay {
  /** Step one: writes the event to the outbox. Await this before answering. Never rejects. */
  keep(id: string, event: Record<string, unknown>, attributes: Record<string, string>): Promise<OutboxEntry>
  /** Step two: publishes one entry and, if the queue took it, removes it. True if it is no longer waiting. Never rejects. */
  send(entry: OutboxEntry): Promise<boolean>
  /** Publishes entries left behind by any copy. Returns how many were sent. Never rejects. */
  sweep(options?: { everything?: boolean }): Promise<number>
  /** Sweeps on a timer. The timer does not keep the process alive. */
  start(): void
  stop(): void
}

export function outboxRelay(sink: EventSink, outbox: Outbox, now: () => number = Date.now): Relay {
  let timer: ReturnType<typeof setInterval> | null = null
  let sweeping = false
  let failures = 0
  let notBefore = Number.NEGATIVE_INFINITY

  const relay: Relay = {
    async keep(id, event, attributes) {
      const entry: OutboxEntry = { id, event, attributes, queuedAt: now() }
      await outbox.put(entry)
      return entry
    },
    async send(entry) {
      let result: Awaited<ReturnType<EventSink['publish']>>
      try {
        result = await sink.publish(entry.event, entry.attributes)
      } catch {
        result = 'retry'
      }
      if (result === 'retry') return false
      if (result === 'refused') console.error(`Outbox: the queue refused event ${entry.id} for good; dropped`)
      await outbox.remove(entry.id)
      return true
    },
    async sweep({ everything = false } = {}) {
      if (sweeping || (!everything && now() < notBefore)) return 0
      sweeping = true
      let sent = 0
      try {
        if (!(await outbox.claimSweep(SWEEP_CLAIM_MS))) return 0
        const due = (await outbox.waiting()).filter((entry) => everything || now() - entry.queuedAt >= GRACE_MS).sort((a, b) => a.queuedAt - b.queuedAt)
        for (const entry of due.slice(0, MAX_PER_SWEEP)) {
          if (now() - entry.queuedAt > GIVE_UP_MS) {
            console.error(`Outbox: event ${entry.id} waited more than three days; dropped`)
            await outbox.remove(entry.id)
            continue
          }
          if (!(await relay.send(entry))) {
            // The queue is not taking events. Stop here, and wait longer before each new try.
            failures += 1
            notBefore = now() + Math.min(SWEEP_EVERY_MS * 2 ** failures, MAX_BACKOFF_MS)
            console.warn(`Outbox: the queue did not take an event; ${due.length - sent} waiting, next try in ${Math.round((notBefore - now()) / 1000)} s`)
            return sent
          }
          sent += 1
        }
        failures = 0
        notBefore = Number.NEGATIVE_INFINITY
        if (sent > 0) console.log(`Outbox: sent ${sent} event${sent === 1 ? '' : 's'} that had been left waiting`)
        return sent
      } catch (error) {
        console.warn('Outbox: sweep failed:', error instanceof Error ? error.message : error)
        return sent
      } finally {
        sweeping = false
      }
    },
    start() {
      if (timer) return
      timer = setInterval(() => void relay.sweep(), SWEEP_EVERY_MS)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
  return relay
}
