import { describe, expect, it } from 'vitest'
import { ID_LETTERS, newId } from './ids'

/**
 * Plan ids are Firestore document ids, and Firestore splits a collection across machines by ranges
 * of document id. Ids that follow one another (a counter, a time) would send every new plan to the
 * one machine holding the end of the range, a "hotspot". Random ids spread new plans over the whole
 * range. These tests pin that the ids are random, not only well-formed.
 */
describe('ids', () => {
  const ids = Array.from({ length: 2000 }, () => newId(8))

  it('are made of the agreed letters, at the asked length', () => {
    for (const id of ids) expect(id).toMatch(new RegExp(`^[${ID_LETTERS}]{8}$`))
  })

  it('do not repeat (31^8 is about 850 billion ids, so 2,000 repeat with odds of about 1 in 400,000)', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('do not follow one another: one made after another is larger only about half the time', () => {
    // A counter or a timestamp would be larger every time (1.0). Random ids are larger half the time;
    // 0.4 to 0.6 is about nine standard deviations either side, so this does not fail by chance.
    const larger = ids.slice(1).filter((id, n) => id > ids[n]).length / (ids.length - 1)
    expect(larger).toBeGreaterThan(0.4)
    expect(larger).toBeLessThan(0.6)
  })

  it('start with every possible letter, so new plans land all over the id range', () => {
    // 2,000 ids over 31 first letters is about 65 each. Missing one has odds below 1 in 10^26.
    expect(new Set(ids.map((id) => id[0])).size).toBe(ID_LETTERS.length)
  })
})
