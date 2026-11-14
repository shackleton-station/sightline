import { describe, expect, it } from 'vitest'
import {
  closeHorizon,
  combineDomains,
  elevationDomain,
  panoramaDomain,
  splitAtWrap,
} from './panorama'

describe('splitAtWrap', () => {
  it('breaks the line where azimuth wraps past 360°', () => {
    const points = [
      { az: 358, el: 1 },
      { az: 359.5, el: 1 },
      { az: 0.5, el: 1 },
      { az: 2, el: 1 },
    ]
    expect(splitAtWrap(points)).toEqual([points.slice(0, 2), points.slice(2)])
  })

  it('keeps a continuous track whole and handles empty input', () => {
    const points = [
      { az: 130, el: 1 },
      { az: 140, el: 2 },
    ]
    expect(splitAtWrap(points)).toEqual([points])
    expect(splitAtWrap([])).toEqual([])
  })
})

describe('closeHorizon', () => {
  it('repeats the first elevation at 360°', () => {
    const closed = closeHorizon([
      { az: 0, el: 2 },
      { az: 180, el: -1 },
    ])
    expect(closed[closed.length - 1]).toEqual({ az: 360, el: 2 })
  })
})

describe('elevationDomain', () => {
  it('pads and rounds outward to whole degrees', () => {
    expect(elevationDomain([-2.76, 0.08, 1.5])).toEqual([-4, 2])
  })

  it('has a fallback for no data', () => {
    expect(elevationDomain([])).toEqual([-1, 1])
  })
})

describe('panoramaDomain', () => {
  it('covers the horizon and both paths', () => {
    const horizon = [{ az: 0, el: -1 }]
    expect(panoramaDomain(horizon, [{ sun_el: 2, earth_el: -6.2 }])).toEqual([-7, 3])
  })
})

describe('panoramaDomain away from the pole', () => {
  it('cuts off paths far below the horizon', () => {
    const horizon = [{ az: 0, el: 0.4 }]
    expect(panoramaDomain(horizon, [{ sun_el: -70, earth_el: 60.2 }])).toEqual([-10, 61])
  })
})

describe('combineDomains', () => {
  it('spans both ranges', () => {
    expect(combineDomains([-8, 6], [-7, 9])).toEqual([-8, 9])
  })
})
