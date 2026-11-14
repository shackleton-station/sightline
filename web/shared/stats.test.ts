import { describe, expect, it } from 'vitest'
import { COUNTERS, countsOf, dayOf, memoryStats, noCounts, SHARDS, shardOf, sumShards } from './stats'

describe('what a question adds', () => {
  it('is always one question, and one more for how it ended', () => {
    expect(countsOf({ cached: false, outcome: 'answered' })).toEqual({ questions: 1, cached: 0, fallback: 0, busy: 0, failed: 0, refused: 0 })
    expect(countsOf({ cached: true, outcome: 'answered' })).toEqual({ questions: 1, cached: 1, fallback: 0, busy: 0, failed: 0, refused: 0 })
    expect(countsOf({ cached: false, outcome: 'fallback' })).toMatchObject({ questions: 1, fallback: 1 })
    expect(countsOf({ cached: false, outcome: 'busy' })).toMatchObject({ questions: 1, busy: 1 })
    expect(countsOf({ cached: false, outcome: 'error' })).toMatchObject({ questions: 1, failed: 1 })
    // A question the model declined is its own count, not a failure.
    expect(countsOf({ cached: false, outcome: 'refused' })).toEqual({ questions: 1, cached: 0, fallback: 0, busy: 0, failed: 0, refused: 1 })
  })

  it('names a day in UTC', () => {
    expect(dayOf(Date.parse('2026-11-12T23:59:59Z'))).toBe('2026-11-12')
    expect(dayOf(Date.parse('2026-11-13T00:00:00Z'))).toBe('2026-11-13')
  })
})

describe('shards', () => {
  it('sends the same event to the same shard every time, inside the range', () => {
    for (const key of ['e-1', 'e-2', 'm-1001', 'e-3f0c2f0e-6c58-4c53-9b1c-0d7e5a1f2b3c']) {
      const shard = shardOf(key)
      expect(shard).toBe(shardOf(key))
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(SHARDS)
    }
    expect(shardOf('anything', 1)).toBe(0)
  })

  it('spreads events over every shard, roughly evenly', () => {
    const perShard = new Array<number>(SHARDS).fill(0)
    for (let i = 0; i < 4000; i++) perShard[shardOf(`e-${i}`)] += 1
    // 500 each if perfectly even. A hot shard would show as one far above the rest.
    for (const count of perShard) {
      expect(count).toBeGreaterThan(400)
      expect(count).toBeLessThan(600)
    }
  })

  it('adds the shards up on read, and ignores what is not a count', () => {
    expect(sumShards([])).toEqual(noCounts())
    expect(
      sumShards([
        { questions: 3, cached: 1, fallback: 0, busy: 0, failed: 1 },
        { questions: '4', cached: '2' }, // as Firestore sends integers, and with fields missing
        { questions: 1, failed: 1, busy: -5, fallback: 'many' },
      ]),
    ).toEqual({ questions: 8, cached: 3, fallback: 0, busy: 0, failed: 2, refused: 0 })
  })

  it('gives the same total whatever the number of shards', async () => {
    const totals = []
    for (const shards of [1, 2, 8, 32]) {
      const store = memoryStats(shards)
      for (let i = 0; i < 200; i++) await store.count({ key: `e-${i}`, day: 'd', add: countsOf({ cached: i % 4 === 0, outcome: i % 10 === 0 ? 'error' : 'answered' }) })
      const read = await store.read('d')
      expect(read.shards).toBe(Math.min(shards, 200))
      // No one shard holds the total (unless there is only one).
      if (shards > 1) expect(Math.max(...store.shardsOf('d').map((shard) => shard.questions))).toBeLessThan(200)
      totals.push(read.counts)
    }
    for (const total of totals) expect(total).toEqual({ questions: 200, cached: 50, fallback: 0, busy: 0, failed: 20, refused: 0 })
  })
})

describe('the store in memory', () => {
  it('counts a key once and keeps days apart', async () => {
    const store = memoryStats()
    const add = countsOf({ cached: false, outcome: 'answered' })
    expect(await store.count({ key: 'e-1', day: '2026-11-12', add })).toBe('counted')
    expect(await store.count({ key: 'e-1', day: '2026-11-12', add })).toBe('duplicate')
    expect(await store.count({ key: 'e-2', day: '2026-11-13', add })).toBe('counted')
    expect((await store.read('2026-11-12')).counts.questions).toBe(1)
    expect((await store.read('2026-11-13')).counts.questions).toBe(1)
    expect(await store.read('2026-11-14')).toEqual({ day: '2026-11-14', counts: noCounts(), shards: 0 })
    expect(COUNTERS).toEqual(['questions', 'cached', 'fallback', 'busy', 'failed', 'refused'])
  })
})
