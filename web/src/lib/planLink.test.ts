import { describe, expect, it } from 'vitest'
import { classicPlanAddress, planLink, planTabTitle, sightlineView } from './planLink'

describe('short links to saved plans', () => {
  it('opens a plan on the site\'s front page, the Sightline screen', () => {
    expect(planLink('https://lunarsightline.com', 'abcd2345')).toBe('https://lunarsightline.com/#plan=abcd2345')
    expect(classicPlanAddress('abcd2345')).toBe('/classic/#plan=abcd2345')
  })

  it("puts a saved plan's name first in the tab's title", () => {
    expect(planTabTitle('Ridge and rim in May')).toBe('Ridge and rim in May · Sightline')
  })

  it('opens a plan saved from the Sightline screen as it is, with everything the screen added to it', () => {
    const view = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&hp=5&sc=1&panel=compare&sl=1'
    expect(sightlineView(view)).toBe(view)
  })

  it('opens an unmarked plan here when nothing it held would be lost: it is in Plan and its 3D switch is off', () => {
    // Saved from this screen before the mark existed, or from the older screen's Plan.
    const view = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&hp=5&sc=1'
    expect(sightlineView(view)).toBe(view)
    // A link from before the mode was written means Plan.
    expect(sightlineView('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1')).toBe('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1')
  })

  it("keeps an older plan's comparison: it becomes a second scenario at the same hour of its own month", () => {
    expect(sightlineView('#a=connecting-ridge@2027-06&b=shackleton-rim@2027-06&t=497&limits=14_72_72_1_1&mode=plan')).toBe('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&mode=plan&list=shackleton-rim@2027-06-21T17')
  })

  it('sends an older plan to the older screen when this one would lose something it held: its 3D view, or Learn', () => {
    expect(sightlineView('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&view=3d&mode=plan')).toBeNull()
    expect(sightlineView('#a=connecting-ridge@2027-06&b=shackleton-rim@2027-06&t=497&limits=14_72_72_1_1&view=3d&mode=plan')).toBeNull()
    expect(sightlineView('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&mode=learn')).toBeNull()
  })

  it('goes by the mark, not by the address: a marked plan opens here whatever else its view holds', () => {
    expect(sightlineView('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&mode=plan&sl=1')).not.toBeNull()
  })

  it('has no match for something that is not a view', () => {
    expect(sightlineView('#how')).toBeNull()
    expect(sightlineView('')).toBeNull()
    expect(sightlineView('https://evil.example')).toBeNull()
  })
})
