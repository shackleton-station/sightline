import { describe, expect, it } from 'vitest'
import { forwardOldAddress } from './oldAddress'
import { readScenarioLink } from './sightlineMission'

const at = (address: string) => {
  const url = new URL(address, 'https://site.example')
  return forwardOldAddress({ pathname: url.pathname, search: url.search, hash: url.hash })
}

describe('an old address opened at the front page', () => {
  it('stays when it is the bare front page or a link Sightline wrote', () => {
    expect(at('/')).toEqual({ kind: 'stay' })
    expect(at('/#')).toEqual({ kind: 'stay' })
    expect(at('/#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&sc=1')).toEqual({ kind: 'stay' })
    // Sightline's own address while it was built is not the front page: nothing to forward.
    expect(at('/sightline/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&view=3d&mode=learn')).toEqual({ kind: 'stay' })
    expect(at('/atlas/#demo')).toEqual({ kind: 'stay' })
  })

  it('opens a Classic link on the same site, hour and limits', () => {
    const moved = at('/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&view=3d&mode=learn')
    expect(moved).toEqual({ kind: 'rewrite', to: '/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=learn' })
    // Sightline reads it: Apollo 11, the sixth hour of March 2028, the link's own limits.
    const read = readScenarioLink('#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=learn', '2026-01-01T00:00:00Z', 4 * 8766)
    expect(read?.scenarios[0].site).toBe('apollo-11')
    expect(new Date(Date.parse('2026-01-01T00:00:00Z') + (read?.scenarios[0].landing ?? 0) * 3_600_000).toISOString()).toBe('2028-03-01T05:00:00.000Z')
    expect(read?.mission.requirements).toMatchObject({ missionDays: 14, maxSunGapH: 72, maxEarthGapH: 72 })
  })

  it('opens a Mission control link the same way, without its design switch', () => {
    expect(at('/?ui=next#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan')).toEqual({ kind: 'rewrite', to: '/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan' })
    expect(at('/?ui=next')).toEqual({ kind: 'rewrite', to: '/' })
  })

  it('turns a comparison into a second scenario at the same hour of its own month', () => {
    expect(at('/#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&b=shackleton-rim@2027-06&mode=plan')).toEqual({
      kind: 'rewrite',
      to: '/#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-06-06T13',
    })
    // Ahead of a shortlist the link already had, and never past the end of a shorter month.
    expect(at('/#a=connecting-ridge@2027-05&t=740&limits=14_24_99999_1_1&b=apollo-11@2027-02&list=slim@2027-03-01T00')).toEqual({
      kind: 'rewrite',
      to: '/#a=connecting-ridge@2027-05&t=740&limits=14_24_99999_1_1&list=apollo-11@2027-02-28T23~slim@2027-03-01T00',
    })
  })

  it('opens How it works in Sightline', () => {
    expect(at('/#how')).toEqual({ kind: 'how' })
  })

  it('goes to the old page where Sightline has no match: the demo video, the tour, a shared plan, following a presenter', () => {
    expect(at('/#demo')).toEqual({ kind: 'leave', to: '/classic/#demo' })
    expect(at('/#tour')).toEqual({ kind: 'leave', to: '/classic/#tour' })
    expect(at('/#plan=abcd2345')).toEqual({ kind: 'leave', to: '/classic/#plan=abcd2345' })
    expect(at('/?follow=abc234')).toEqual({ kind: 'leave', to: '/classic/?follow=abc234' })
    expect(at('/?follow=abc234&ui=next#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1')).toEqual({ kind: 'leave', to: '/classic/?follow=abc234&ui=next#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1' })
  })
})
