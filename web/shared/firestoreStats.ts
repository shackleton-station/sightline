import type { TokenSource } from './google'
import { COUNT_DAYS, COUNTERS, type Counter, type Counts, type DayCounts, SEEN_DAYS, SHARDS, shardOf, type StatsReader, type StatsStore, sumShards } from './stats'
import { span } from './trace'

/**
 * The counts in Firestore, database `stats`, through its REST API with the caller's own identity.
 *
 *   seen/<key>                    one small document per counted event: the record that makes a
 *                                 second delivery of the same event a no-op. Firestore deletes it
 *                                 after `expires` (a time-to-live rule, infra/worker.tf).
 *   days/<day>/shards/<number>    one document per shard of a day's counter (see shared/stats.ts).
 *
 * Only the events worker writes here (its identity alone has the role for it). The web server reads
 * `days/<day>/shards` with a read-only role.
 */
export interface FirestoreOptions {
  project: string
  database: string
  /** The API's address. Only tests against the emulator change it. */
  host?: string
  shards?: number
  now?: () => number
}

const DAY_MS = 24 * 60 * 60_000
/** Longer than a commit should ever take, shorter than the queue's wait for an answer (infra/worker.tf). */
const PATIENCE_MS = 10_000
/** Names that are safe as part of a document's path. */
const DAY = /^[a-z0-9-]{1,40}$/
const KEY = /^[A-Za-z0-9_-]{1,80}$/

type Value = { integerValue?: string; doubleValue?: number; stringValue?: string; timestampValue?: string }
interface FirestoreError {
  error?: { status?: string; message?: string }
}

function paths(options: FirestoreOptions) {
  const database = `projects/${options.project}/databases/${options.database}`
  const api = `${options.host ?? 'https://firestore.googleapis.com'}/v1/${database}/documents`
  return { api, documents: `${database}/documents` }
}

/** Reads the day's shards and adds them up. One call; each shard returned is one document read. */
export function firestoreStatsReader(options: FirestoreOptions, token: TokenSource): StatsReader {
  const { api } = paths(options)
  return {
    kind: 'firestore',
    read(day) {
      return span('counters from Firestore', async (): Promise<DayCounts> => {
        if (!DAY.test(day)) throw new Error('Firestore: not a day')
        // 100 is far more shards than a day will ever have, so one page is the whole day.
        const response = await fetch(`${api}/days/${day}/shards?pageSize=100`, { headers: { authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(PATIENCE_MS) })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`Firestore: HTTP ${response.status} reading the counters`)
        }
        const { documents = [] } = (await response.json()) as { documents?: { fields?: Record<string, Value> }[] }
        const shards = documents.map((document) => Object.fromEntries(COUNTERS.map((name) => [name, document.fields?.[name]?.integerValue ?? document.fields?.[name]?.doubleValue ?? 0])) as Record<Counter, unknown>)
        return { day, counts: sumShards(shards), shards: shards.length }
      })
    },
  }
}

export function firestoreStats(options: FirestoreOptions, token: TokenSource): StatsStore {
  const { api, documents } = paths(options)
  const now = options.now ?? Date.now
  const shards = options.shards ?? SHARDS
  const headers = async () => ({ 'content-type': 'application/json', authorization: `Bearer ${await token()}` })

  /** Whether an event's key is already recorded. Only asked when a refusal does not say why. */
  async function alreadySeen(key: string): Promise<boolean> {
    const response = await fetch(`${api}/seen/${key}?mask.fieldPaths=day`, { headers: await headers(), signal: AbortSignal.timeout(PATIENCE_MS) })
    await response.body?.cancel()
    if (response.status === 404) return false
    if (!response.ok) throw new Error(`Firestore: HTTP ${response.status} checking an event`)
    return true
  }

  return {
    ...firestoreStatsReader(options, token),
    count({ key, day, add }, keep = { seenDays: SEEN_DAYS, countDays: COUNT_DAYS }) {
      return span('count once in Firestore', async () => {
        if (!DAY.test(day) || !KEY.test(key)) throw new Error('Firestore: not a day or not a key')
        const at = now()
        const until = (days: number) => ({ timestampValue: new Date(at + days * DAY_MS).toISOString() })
        const adds = COUNTERS.filter((name) => add[name] !== 0).map((name) => ({ fieldPath: name, increment: { integerValue: String(add[name]) } }))
        /**
         * One commit, two writes, applied together or not at all.
         *   1. Create the record of this event's key, on the condition that it does not exist.
         *   2. Add to one shard of the day's counter. The increment is done by Firestore, so two
         *      workers adding at once cannot overwrite each other.
         * If the key is already there, write 1 fails its condition and Firestore refuses the whole
         * commit, so write 2 never happens: an event delivered twice is counted once.
         */
        const body = {
          writes: [
            { update: { name: `${documents}/seen/${key}`, fields: { day: { stringValue: day }, expires: until(keep.seenDays) } }, currentDocument: { exists: false } },
            {
              update: { name: `${documents}/days/${day}/shards/${shardOf(key, shards)}`, fields: { day: { stringValue: day }, expires: until(keep.countDays) } },
              // Only these two fields are set outright; the counters are left alone and added to below.
              updateMask: { fieldPaths: ['day', 'expires'] },
              updateTransforms: adds,
            },
          ],
        }
        const response = await fetch(`${api}:commit`, { method: 'POST', headers: await headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(PATIENCE_MS) })
        if (response.ok) {
          await response.body?.cancel()
          return 'counted' as const
        }
        const status = ((await response.json().catch(() => ({}))) as FirestoreError).error?.status ?? `HTTP ${response.status}`
        // ALREADY_EXISTS and ABORTED ("lost to another write, try again") both arrive as HTTP 409,
        // so the HTTP code cannot tell a duplicate from contention: the status name does.
        if (status === 'ALREADY_EXISTS') return 'duplicate' as const
        // The documentation does not say which status a failed "must not exist" gives, so the other
        // candidate is checked the slow way: is the key recorded?
        if (status === 'FAILED_PRECONDITION' && (await alreadySeen(key))) return 'duplicate' as const
        throw new Error(`Firestore: ${status} counting an event`)
      })
    },
  }
}

/** The counts as the worker serves them when everything runs on one machine and there is no shared database. */
export function workerStatsReader(url: string): StatsReader {
  return {
    kind: 'worker',
    async read(day) {
      const response = await fetch(`${url}?day=${encodeURIComponent(day)}`, { signal: AbortSignal.timeout(2000) })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`The worker: HTTP ${response.status} reading the counters`)
      }
      const { counts, shards } = (await response.json()) as { counts: Partial<Counts>; shards?: number }
      return { day, counts: sumShards([counts]), shards: shards ?? 0 }
    },
  }
}
