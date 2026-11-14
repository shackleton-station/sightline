import { describe, expect, it } from 'vitest'
import { readCounts, shareOf } from './questionCounts'

describe("today's question counts", () => {
  const reply = { day: '2026-11-12', counts: { questions: 12, cached: 3, fallback: 1, busy: 0, failed: 2 }, shards: 5, asOf: '2026-11-12T12:00:00.000Z' }

  it('reads the server\'s reply, ignoring fields the page does not know', () => {
    expect(readCounts(reply)).toEqual({ day: '2026-11-12', questions: 12, cached: 3, fallback: 1, busy: 0, failed: 2 })
    expect(readCounts({ ...reply, something_new: true, counts: { ...reply.counts, another: 9 } })).toEqual(readCounts(reply))
  })

  it('refuses a reply that is not counts, so the page says "can\'t be read" instead of showing nonsense', () => {
    for (const body of [null, 'x', {}, { error: 'not-configured' }, { day: 'today', counts: reply.counts }, { day: '2026-11-12' }, { day: '2026-11-12', counts: { ...reply.counts, questions: '12' } }, { day: '2026-11-12', counts: { ...reply.counts, failed: -1 } }, { day: '2026-11-12', counts: { questions: 1 } }]) {
      expect(readCounts(body), JSON.stringify(body)).toBeNull()
    }
  })

  it('gives a share as a whole percentage, and none of nothing', () => {
    expect(shareOf(3, 12)).toBe(25)
    expect(shareOf(1, 3)).toBe(33)
    expect(shareOf(0, 5)).toBe(0)
    expect(shareOf(0, 0)).toBeNull()
  })
})
