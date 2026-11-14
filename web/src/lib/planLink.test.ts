import { describe, expect, it } from 'vitest'
import { classicPlanAddress, planLink, sightlineView } from './planLink'

describe('short links to saved plans', () => {
  it('opens a plan on the site\'s front page, the Sightline screen', () => {
    expect(planLink('https://lunarsightline.com', 'abcd2345')).toBe('https://lunarsightline.com/#plan=abcd2345')
    expect(classicPlanAddress('abcd2345')).toBe('/classic/#plan=abcd2345')
  })

  it('opens a Sightline view as it is, with everything the screen added to it', () => {
    const view = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&hp=5&sc=1&panel=compare'
    expect(sightlineView(view)).toBe(view)
  })

  it('maps a view saved on the older screen: its comparison becomes a second scenario, its 3D switch is dropped', () => {
    expect(sightlineView('#a=connecting-ridge@2027-06&b=shackleton-rim@2027-06&t=497&limits=14_72_72_1_1&view=3d&mode=plan')).toBe('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&mode=plan&list=shackleton-rim@2027-06-21T17')
  })

  it('has no match for something that is not a view', () => {
    expect(sightlineView('#how')).toBeNull()
    expect(sightlineView('')).toBeNull()
    expect(sightlineView('https://evil.example')).toBeNull()
  })
})
