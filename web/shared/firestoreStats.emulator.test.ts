import { describe, expect, it } from 'vitest'
import { firestoreStats, firestoreStatsReader } from './firestoreStats'
import { countsOf, SHARDS } from './stats'

/**
 * The same store code against Google's Firestore emulator, to check what a fake cannot: that the
 * REST calls are shaped right, that the two writes really are one atomic step, and what Firestore
 * answers when the event's key already exists.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set (CI has no emulator). To run it:
 *
 *   docker run --rm -p 127.0.0.1:8085:8085 gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
 *     gcloud emulators firestore start --host-port=0.0.0.0:8085 --project=demo-clps
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx vitest run shared/firestoreStats.emulator.test.ts
 */
const emulator = process.env.FIRESTORE_EMULATOR_HOST
const options = { project: 'demo-clps', database: '(default)', host: `http://${emulator}` }
// The emulator takes "owner" as a token that may do anything.
const token = () => Promise.resolve('owner')
const add = countsOf({ cached: true, outcome: 'answered' })
const unique = () => Math.random().toString(36).slice(2, 10)

describe.skipIf(!emulator)('the counters on the Firestore emulator', () => {
  it('counts an event once, however often it arrives, and a read adds the shards up', async () => {
    const store = firestoreStats(options, token)
    const day = `t-${unique()}`
    const key = `e-${unique()}`
    expect(await store.count({ key, day, add })).toBe('counted')
    // The same key again: Firestore refuses the whole commit, so the counter is not touched.
    expect(await store.count({ key, day, add })).toBe('duplicate')
    expect(await store.count({ key, day, add })).toBe('duplicate')
    expect(await store.read(day)).toEqual({ day, counts: { questions: 1, cached: 1, fallback: 0, busy: 0, failed: 0 }, shards: 1 })
  })

  it('adds many events at once without losing one, across every shard', async () => {
    const store = firestoreStats(options, token)
    const day = `t-${unique()}`
    const keys = Array.from({ length: 60 }, (_, i) => `e-${unique()}-${i}`)
    const results = await Promise.all(keys.map((key) => store.count({ key, day, add: countsOf({ cached: false, outcome: 'error' }) })))
    expect(results.every((result) => result === 'counted')).toBe(true)
    // Every one of them again, at once: none is counted twice.
    const again = await Promise.all(keys.map((key) => store.count({ key, day, add: countsOf({ cached: false, outcome: 'error' }) })))
    expect(again.every((result) => result === 'duplicate')).toBe(true)
    const read = await firestoreStatsReader(options, token).read(day)
    expect(read.counts).toEqual({ questions: 60, cached: 0, fallback: 0, busy: 0, failed: 60 })
    expect(read.shards).toBe(SHARDS)
  })

  it('reads a day with nothing counted as zeros', async () => {
    expect(await firestoreStatsReader(options, token).read(`t-${unique()}`)).toEqual({ day: expect.any(String), counts: { questions: 0, cached: 0, fallback: 0, busy: 0, failed: 0 }, shards: 0 })
  })
})
