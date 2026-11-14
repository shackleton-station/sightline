import { describe, expect, it } from 'vitest'
import type { Requirements } from './mission'
import { decodeView, encodeView, parseCustomSite, type ViewState } from './urlState'

const limits: Requirements = {
  missionDays: 14,
  maxSunGapH: 72,
  maxEarthGapH: 48,
  sunAtLanding: true,
  earthAtLanding: false,
  minEarthClearanceDeg: 0,
}

describe('view links', () => {
  it('round-trips a comparison', () => {
    const view: ViewState = {
      a: { site: 'connecting-ridge', month: '2027-03' },
      b: { site: '-43.3,-11.2', month: '2027-05' },
      index: 300,
      requirements: limits,
      view3d: false,
      mode: 'plan' as const,
      shortlist: [],
    }
    expect(decodeView(encodeView(view), limits)).toEqual(view)
  })

  it('round-trips a single scenario', () => {
    const view: ViewState = {
      a: { site: 'apollo-11', month: '2027-12' },
      b: null,
      index: 0,
      requirements: limits,
      view3d: false,
      mode: 'plan' as const,
      shortlist: [],
    }
    expect(decodeView(encodeView(view), limits)).toEqual(view)
  })

  it('stays readable', () => {
    const hash = encodeView({
      a: { site: '-43.3,-11.2', month: '2027-05' },
      b: null,
      index: 5,
      requirements: limits,
      view3d: false,
      mode: 'plan' as const,
      shortlist: [],
    })
    expect(hash).toBe('#a=-43.3,-11.2@2027-05&t=5&limits=14_72_48_1_0&mode=plan')
  })

  it.each(['', '#', '#a=', '#a=x', '#a=site@2027-13', '#a=<script>@2027-01', '#t=5'])(
    'ignores a bad link: %s',
    (hash) => {
      expect(decodeView(hash, limits)).toBeNull()
    },
  )

  it('falls back on bad parts of a good link', () => {
    const view = decodeView('#a=apollo-11@2027-05&t=-4&limits=nope&b=bad', limits)
    expect(view).toEqual({
      a: { site: 'apollo-11', month: '2027-05' },
      b: null,
      index: 0,
      requirements: limits,
      view3d: false,
      mode: 'plan' as const,
      shortlist: [],
    })
  })
})

describe('parseCustomSite', () => {
  it('reads coordinates', () => {
    expect(parseCustomSite('-43.3,-11.2')).toEqual({ lat: -43.3, lon: -11.2 })
  })

  it('rejects curated ids and impossible values', () => {
    expect(parseCustomSite('apollo-11')).toBeNull()
    expect(parseCustomSite('91,0')).toBeNull()
  })
})

describe('level of detail in a link', () => {
  const limits = {
    missionDays: 14,
    maxSunGapH: 72,
    maxEarthGapH: 72,
    sunAtLanding: true,
    earthAtLanding: true,
    minEarthClearanceDeg: 0,
  }
  const view = {
    a: { site: 'apollo-11', month: '2028-02' },
    b: null,
    index: 3,
    requirements: limits,
    view3d: false,
    shortlist: [],
  }

  it('keeps Learn in the link', () => {
    const hash = encodeView({ ...view, mode: 'learn' })
    expect(hash).toContain('mode=learn')
    expect(decodeView(hash, limits)?.mode).toBe('learn')
  })

  it('writes Plan too, and treats a link without a mode as Plan, so older links open as they did', () => {
    expect(encodeView({ ...view, mode: 'plan' })).toContain('mode=plan')
    expect(decodeView('#a=apollo-11@2027-05&t=0&limits=14_72_72_1_1', limits)?.mode).toBe('plan')
  })
})

describe('Earth clearance in a link', () => {
  const view: ViewState = {
    a: { site: 'apollo-11', month: '2028-02' },
    b: null,
    index: 3,
    requirements: { ...limits, minEarthClearanceDeg: 2 },
    view3d: false,
    mode: 'plan',
    shortlist: [],
  }

  it('round-trips', () => {
    expect(decodeView(encodeView(view), limits)?.requirements.minEarthClearanceDeg).toBe(2)
  })

  it('leaves links as they were when no clearance is set', () => {
    const none = { ...view, requirements: limits }
    expect(encodeView(none)).toContain('limits=14_72_48_1_0&')
  })

  it('reads old links as no clearance, and ignores values the data has no flags for', () => {
    expect(decodeView('#a=apollo-11@2027-05&limits=14_72_72_1_1', limits)?.requirements.minEarthClearanceDeg).toBe(0)
    expect(decodeView('#a=apollo-11@2027-05&limits=14_72_72_1_1_3', limits)?.requirements.minEarthClearanceDeg).toBe(0)
  })
})

describe('shortlist in a link', () => {
  const view: ViewState = {
    a: { site: 'apollo-11', month: '2028-02' },
    b: null,
    index: 3,
    requirements: limits,
    view3d: false,
    mode: 'plan',
    shortlist: [
      { site: 'connecting-ridge', at: '2027-05-14T12' },
      { site: '-89.45,-137.1', at: '2029-01-02T00' },
    ],
  }

  it('round-trips, including custom points', () => {
    expect(decodeView(encodeView(view), limits)?.shortlist).toEqual(view.shortlist)
  })

  it('stays out of the link when empty', () => {
    expect(encodeView({ ...view, shortlist: [] })).not.toContain('list=')
  })

  it('is readable in the address', () => {
    expect(encodeView(view)).toContain('list=connecting-ridge@2027-05-14T12~-89.45,-137.1@2029-01-02T00')
  })

  it('skips malformed options rather than losing the view', () => {
    const decoded = decodeView('#a=apollo-11@2027-05&list=apollo-11@2027-05-01T00~BAD@x~nope', limits)
    expect(decoded?.shortlist).toEqual([{ site: 'apollo-11', at: '2027-05-01T00' }])
  })

  it('reads links from before it existed as an empty list', () => {
    expect(decodeView('#a=apollo-11@2027-05', limits)?.shortlist).toEqual([])
  })
})
