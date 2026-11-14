import { describe, expect, it } from 'vitest'
import { DEFAULT_REQUIREMENTS } from './mission'
import { decodeView } from './urlState'
import { DEFAULT_VIEW, tabLinks } from './siteTabs'

const LIMITS = { missionDays: 14, maxSunGapH: 72, maxEarthGapH: 72, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

describe('the site tabs', () => {
  it('give every page and design its own address', () => {
    const links = Object.fromEntries(tabLinks('#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan').map((tab) => [tab.id, tab.href]))
    expect(links).toEqual({
      // The front page is Sightline, opened on the same view. The site as it was before is at /classic/.
      sightline: '/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      moon: '/classic/',
      classic: '/classic/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      mission: '/classic/?ui=next#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      scout: '/scout/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      planner: '/planner/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      atlas: '/atlas/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      briefing: '/briefing/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      surface: '/surface/#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan',
      tour: '/classic/#tour',
      video: '/classic/#demo',
      how: '/#how',
    })
  })

  it('open the designs on the same view, or on a default when none is chosen', () => {
    const designs = tabLinks('').filter((tab) => tab.design)
    expect(designs.map((tab) => tab.id)).toEqual(['classic', 'mission', 'scout', 'planner', 'atlas', 'briefing', 'surface'])
    for (const tab of designs) expect(tab.href.endsWith(DEFAULT_VIEW)).toBe(true)
    // The default is a link the app can open.
    expect(decodeView(DEFAULT_VIEW, LIMITS)?.a).toEqual({ site: 'connecting-ridge', month: '2027-05' })
    // Its limits are the app's default mission, so a design opened fresh judges as the front page does.
    expect(decodeView(DEFAULT_VIEW, LIMITS)?.requirements).toEqual(DEFAULT_REQUIREMENTS)
    // With no view chosen the Sightline tab is the bare front page, not the default view.
    expect(tabLinks('').find((tab) => tab.id === 'sightline')?.href).toBe('/')
    // Anything that isn't a view link (the How it works address, say) falls back to the default too.
    expect(tabLinks('#how').find((tab) => tab.id === 'scout')?.href).toBe(`/scout/${DEFAULT_VIEW}`)
  })
})
