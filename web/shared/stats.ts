import { createHash } from 'node:crypto'
import type { CountableQuestion } from './events'

/**
 * The day's counts of co-pilot questions, kept by the events worker and read by the web server.
 * Counts only: nothing here ever holds a question's words or anything about who asked.
 *
 * SHARDED COUNTERS. A counter kept in one document is a hot key: every event writes the same
 * document, and Firestore cannot update one document at an unlimited rate (writes to it queue up,
 * and past some rate they are refused as "contention"). So each day's counter is split across
 * `SHARDS` documents. An event adds to one of them, and a reader adds them all up.
 *
 * The trade: more shards allow more writes at once, and make every read cost that many document
 * reads (fan-in on read). The busiest moment this site allows is 30 questions a minute for everyone
 * together (the `chat:all` limit), and they can arrive in the same second. 8 shards spread such a
 * burst to about 4 writes a document. Firestore's documentation gives no number for how many writes
 * a second one document takes, so 8 is a judgement and not a measurement. It can change at any
 * deploy with no migration, because a reader adds up whatever shards exist for the day and never
 * needs to know how many there should be. Raise it if the worker logs contention; lower it if the
 * read bill ever matters.
 *
 * WHICH SHARD. A hash of the event's key, not a random pick. Both spread evenly; the hash also means
 * a retry of the same event writes exactly the same two documents, so a retried write is the same
 * request again and easy to reason about.
 */
export const SHARDS = 8

/** How long a record of "this event was counted" is kept. It must outlast any way the same event can come back: see `docs/decisions/0002-events-worker.md`. */
export const SEEN_DAYS = 7
/** How long a day's counts are kept: as long as the question log they summarize (`question_log_days` in infra/variables.tf). */
export const COUNT_DAYS = 90

/** `refused` came last, with the move to Claude: a day counted before it simply has none (a missing field adds up to zero). */
export const COUNTERS = ['questions', 'cached', 'fallback', 'busy', 'failed', 'refused'] as const
export type Counter = (typeof COUNTERS)[number]
export type Counts = Record<Counter, number>

export const noCounts = (): Counts => ({ questions: 0, cached: 0, fallback: 0, busy: 0, failed: 0, refused: 0 })

/** What one question adds: always one question, and one more for how it ended. */
export function countsOf(question: Pick<CountableQuestion, 'cached' | 'outcome'>): Counts {
  return {
    questions: 1,
    cached: question.cached ? 1 : 0,
    fallback: question.outcome === 'fallback' ? 1 : 0,
    busy: question.outcome === 'busy' ? 1 : 0,
    failed: question.outcome === 'error' ? 1 : 0,
    refused: question.outcome === 'refused' ? 1 : 0,
  }
}

/** The shard an event's count goes to: the same one every time for the same key. */
export function shardOf(key: string, shards: number = SHARDS): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) % shards
}

/** Fan-in on read: the day's count is the sum of its shards. A missing or odd field counts as zero. */
export function sumShards(shards: Partial<Record<Counter, unknown>>[]): Counts {
  const total = noCounts()
  for (const shard of shards) {
    for (const name of COUNTERS) {
      const value = Number(shard[name])
      if (Number.isFinite(value) && value > 0) total[name] += Math.floor(value)
    }
  }
  return total
}

/** A day as the counters name it: `YYYY-MM-DD`, in UTC. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** What a reader gets for one day. */
export interface DayCounts {
  day: string
  counts: Counts
  /** How many shard documents were added up. 0 means nothing has been counted that day. */
  shards: number
}

/** Reading the counts. The web server gets only this half, and a read-only grant to match. */
export interface StatsReader {
  kind: 'firestore' | 'memory' | 'worker'
  /** The day's counts, summed over its shards. Rejects if the store cannot be read. */
  read(day: string): Promise<DayCounts>
}

/** Reading and writing the counts. Only the events worker has this half. */
export interface StatsStore extends StatsReader {
  /**
   * Counts one event, once. One atomic step does both things: it records that this key has been
   * counted, and adds to the day's counter. If the key is already recorded the whole step is
   * refused and nothing is added: `duplicate`. Rejects if the store fails, so the caller can ask
   * the queue to deliver the message again.
   */
  count(event: { key: string; day: string; add: Counts }, keep?: { seenDays: number; countDays: number }): Promise<'counted' | 'duplicate'>
}

/** The store in this process's memory: for tests, and for running everything on one machine. */
export function memoryStats(shards: number = SHARDS): StatsStore & { shardsOf(day: string): Counts[] } {
  const seen = new Set<string>()
  const days = new Map<string, Map<number, Counts>>()
  return {
    kind: 'memory',
    count({ key, day, add }) {
      if (seen.has(key)) return Promise.resolve('duplicate')
      seen.add(key)
      const day_ = days.get(day) ?? new Map<number, Counts>()
      days.set(day, day_)
      const shard = shardOf(key, shards)
      const counts = day_.get(shard) ?? noCounts()
      for (const name of COUNTERS) counts[name] += add[name]
      day_.set(shard, counts)
      return Promise.resolve('counted')
    },
    read(day) {
      const found = [...(days.get(day)?.values() ?? [])]
      return Promise.resolve({ day, counts: sumShards(found), shards: found.length })
    },
    shardsOf: (day) => [...(days.get(day)?.values() ?? [])],
  }
}
