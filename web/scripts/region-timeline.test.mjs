import { describe, expect, it } from 'vitest'
import { describeStory, regionOf, serviceStory } from './region-timeline.mjs'

const good = (t, region) => ({ t, code: 200, region, drill: false })
const drill = (t, region) => ({ t, code: 503, region, drill: true })

describe('the region an answer came from', () => {
  it('is the region a status address or the drill names, and unknown otherwise', () => {
    expect(regionOf({ region: 'us-central1', revision: 'x' })).toBe('us-central1')
    expect(regionOf({ drill: 'unavailable', region: 'us-east4' })).toBe('us-east4')
    expect(regionOf({ region: null })).toBe('unknown')
    expect(regionOf(null)).toBe('unknown')
    expect(regionOf('not json')).toBe('unknown')
  })
})

describe("one service's story", () => {
  it('a quiet watch: one region, nothing failed, no switch', () => {
    const story = serviceStory([good(0, 'us-east4'), good(1, 'us-east4')])
    expect(story).toEqual({ regions: { 'us-east4': 2 }, failures: { total: 0, byStatus: {} }, switches: [], firstFailure: null, lastFailure: null, failover: null })
    expect(describeStory('web', story)).toBe('web      answered by: us-east4 2. none failed. no switch')
  })

  it('the drill: the near region fails, the far one answers, and the near one comes back', () => {
    const story = serviceStory([good(0, 'us-east4'), drill(1, 'us-east4'), drill(2, 'us-east4'), drill(3, 'us-east4'), good(4, 'us-central1'), good(5, 'us-central1'), drill(35, 'us-east4'), good(36, 'us-central1'), good(90, 'us-east4')])
    expect(story.regions).toEqual({ 'us-east4': 2, 'us-central1': 3 })
    expect(story.failures).toEqual({ total: 4, byStatus: { 503: 4 } })
    expect(story.switches).toEqual([
      { t: 4, from: 'us-east4', to: 'us-central1' },
      { t: 90, from: 'us-central1', to: 'us-east4' },
    ])
    expect(story.firstFailure).toBe(1)
    expect(story.lastFailure).toBe(35)
    expect(story.failover).toBe(3)
    expect(describeStory('plans', story)).toBe('plans    answered by: us-east4 2, us-central1 3. 4 failed (503 x4), first at 1.0 s, last at 35.0 s. us-east4 -> us-central1 at 4.0 s; us-central1 -> us-east4 at 90.0 s; answered from another region 3 s after the first failure')
  })

  it('blames an unnamed failure (a timeout) on the region that answered last', () => {
    const story = serviceStory([good(0, 'us-east4'), { t: 1, code: 0, region: 'unknown', drill: false }, good(2, 'us-east4'), good(3, 'us-central1')])
    expect(story.failures.byStatus).toEqual({ 'no answer': 1 })
    expect(story.failover).toBe(2)
  })

  it('no failover when the same region answers again after failing', () => {
    expect(serviceStory([drill(0, 'us-east4'), good(1, 'us-east4')]).failover).toBeNull()
  })
})
