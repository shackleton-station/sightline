import { describe, expect, it } from 'vitest'
import type { SiteInfo } from '../data/contract'
import { type Action, DEFAULT_MONTH, hashOf, initialView, type View, viewReducer } from './viewStore'

const site = (id: string): SiteInfo =>
  ({ id, name: id, lat: -89, lon: 10, source_url: 'https://example.test', group: 'South pole ridges' }) as SiteInfo
const SITES = [site('connecting-ridge'), site('shackleton-rim'), site('apollo-11')]

function run(view: View, ...actions: Action[]): View {
  return actions.reduce(viewReducer, view)
}
const loaded = (hash = '', open3d = false) =>
  run(initialView(hash), { type: 'sitesLoaded', sites: SITES, hash, open3d })

describe('opening the app', () => {
  it('opens a fresh visit on the whole Moon, with the first site ready behind it', () => {
    const view = loaded()
    expect(view.landing).toBe(true)
    expect(view.a).toEqual({ siteId: 'connecting-ridge', month: DEFAULT_MONTH })
    expect(view.mode).toBe('learn')
  })

  it('opens a link straight on the view it describes', () => {
    const view = loaded('#a=apollo-11@2028-07&b=shackleton-rim@2028-07&t=42&limits=10_48_24_1_0&view=3d&mode=learn')
    expect(view.landing).toBe(false)
    expect(view.a).toEqual({ siteId: 'apollo-11', month: '2028-07' })
    expect(view.b).toEqual({ siteId: 'shackleton-rim', month: '2028-07' })
    expect(view.index).toBe(42)
    expect(view.view3d).toBe(true)
    expect(view.requirements.missionDays).toBe(10)
    expect(view.mode).toBe('learn')
  })

  it('opens a link with no mode in Plan, as links from before Learn always did', () => {
    expect(loaded('#a=apollo-11@2027-05&t=0&limits=14_72_72_1_1').mode).toBe('plan')
  })

  it('opens a custom-coordinates link', () => {
    const view = loaded('#a=-43.3,-11.2@2027-05&t=5&limits=14_72_48_1_0')
    expect(view.a?.custom?.lat).toBe(-43.3)
    expect(view.a?.custom?.lon).toBe(-11.2)
  })

  it('falls back to the first site when a link names a site we do not have', () => {
    const view = loaded('#a=mars-base@2027-05')
    expect(view.a?.siteId).toBe('connecting-ridge')
  })

  it('starts the tour from a #tour link, opening 3D where the device suits it', () => {
    const view = loaded('#tour', true)
    expect(view.tour?.camera).toBe('above')
    expect(view.view3d).toBe(true)
  })

  it('keeps an error when the site list fails to load', () => {
    expect(run(initialView(''), { type: 'sitesFailed', error: 'HTTP 500' }).sitesError).toBe('HTTP 500')
  })
})

describe('links', () => {
  it('writes a link that reopens the same view', () => {
    const view = run(
      loaded('#a=apollo-11@2028-07&t=42&limits=10_48_24_1_0&mode=plan'),
      { type: 'setIndex', index: 7 },
      { type: 'setMode', mode: 'learn' },
    )
    const again = loaded(hashOf(view))
    expect(again.a).toEqual(view.a)
    expect(again.index).toBe(7)
    expect(again.mode).toBe('learn')
    expect(again.requirements).toEqual(view.requirements)
  })

  it('always says which mode, so Plan and Learn links both round-trip', () => {
    expect(hashOf(run(loaded(), { type: 'setMode', mode: 'plan' }))).toContain('mode=plan')
    expect(hashOf(loaded())).toContain('mode=learn')
  })

  it('follows a link pasted into the open tab, and ignores one it cannot read', () => {
    const view = loaded()
    const followed = run(view, { type: 'applyLink', hash: '#a=shackleton-rim@2029-01&t=3&limits=14_72_72_1_1' })
    expect(followed.a).toEqual({ siteId: 'shackleton-rim', month: '2029-01' })
    expect(run(view, { type: 'applyLink', hash: '#nonsense' })).toBe(view)
  })

  it('has no link before a site is chosen', () => {
    expect(hashOf(initialView(''))).toBe('')
  })
})

describe('comparing', () => {
  it('opens a comparison with another site in the same month, and closes it', () => {
    const open = run(loaded(), { type: 'openCompare' })
    expect(open.b).toEqual({ siteId: 'shackleton-rim', month: DEFAULT_MONTH })
    expect(run(open, { type: 'closeCompare' }).b).toBeNull()
  })

  it('changes either side on its own', () => {
    const view = run(
      loaded(),
      { type: 'setScenario', side: 'b', scenario: { siteId: 'apollo-11', month: '2028-01' } },
      { type: 'setScenario', side: 'a', scenario: { siteId: 'shackleton-rim', month: '2028-01' } },
    )
    expect(view.a?.siteId).toBe('shackleton-rim')
    expect(view.b?.siteId).toBe('apollo-11')
  })
})

describe('the tour', () => {
  const before = run(
    loaded('#a=apollo-11@2028-07&b=shackleton-rim@2028-07&t=42&limits=14_72_72_1_1'),
    { type: 'setView3d', view3d: false },
  )

  it('closes a comparison, moves through scenes, and puts everything back when left', () => {
    const touring = run(
      before,
      { type: 'startTour', open3d: true },
      { type: 'tourScene', siteId: 'connecting-ridge', month: '2027-06', camera: 'sun' },
      { type: 'setIndex', index: 300 },
    )
    expect(touring.b).toBeNull()
    expect(touring.view3d).toBe(true)
    expect(touring.tour?.camera).toBe('sun')
    expect(touring.a).toEqual({ siteId: 'connecting-ridge', month: '2027-06' })

    const left = run(touring, { type: 'closeTour', keepView: false })
    expect(left.tour).toBeNull()
    expect(left.a).toEqual(before.a)
    expect(left.b).toEqual(before.b)
    expect(left.index).toBe(42)
    expect(left.view3d).toBe(false)
  })

  it('keeps the scene it ended on when asked, and can jump to the grid', () => {
    const touring = run(
      before,
      { type: 'startTour', open3d: false },
      { type: 'tourScene', siteId: 'connecting-ridge', month: '2027-06', camera: 'earth' },
    )
    expect(run(touring, { type: 'closeTour', keepView: true }).a?.siteId).toBe('connecting-ridge')
    const grid = run(touring, { type: 'openGrid' })
    expect(grid.tour).toBeNull()
    expect(grid.gridRequest).toBe(before.gridRequest + 1)
  })

  it('pauses and resumes', () => {
    const touring = run(before, { type: 'startTour', open3d: false }, { type: 'pauseTour', paused: true })
    expect(touring.tourPaused).toBe(true)
  })
})

describe('the front page', () => {
  it('enters a site from the globe, keeping the month and closing any comparison', () => {
    const view = run(
      loaded(),
      { type: 'setScenario', side: 'a', scenario: { siteId: 'connecting-ridge', month: '2029-03' } },
      { type: 'openCompare' },
      { type: 'enterSite', site: SITES[2] },
    )
    expect(view.landing).toBe(false)
    expect(view.a).toEqual({ siteId: 'apollo-11', month: '2029-03' })
    expect(view.b).toBeNull()
  })

  it('enters a custom point picked on the globe', () => {
    const custom = { ...site('-12.5,40.25'), group: 'Custom', lat: -12.5, lon: 40.25 }
    const view = run(loaded(), { type: 'enterSite', site: custom })
    expect(view.a?.custom).toEqual(custom)
  })

  it('goes back to the whole Moon from anywhere, and on to the demo page', () => {
    const inApp = run(loaded(), { type: 'enterSite', site: SITES[0] }, { type: 'setPage', page: 'demo' })
    const back = run(inApp, { type: 'openLanding' })
    expect(back.landing).toBe(true)
    expect(back.page).toBe('app')
    expect(run(back, { type: 'leaveLanding' }, { type: 'setPage', page: 'demo' }).page).toBe('demo')
  })

  it('gives How it works its own address, and leaves it for a pasted view link', () => {
    expect(initialView('#how')).toMatchObject({ page: 'how', landing: true })
    expect(initialView('')).toMatchObject({ page: 'app', landing: true })
    const open = viewReducer({ ...initialView(''), sites: SITES }, { type: 'applyLink', hash: '#how' })
    expect(open.page).toBe('how')
    const back = viewReducer(open, { type: 'applyLink', hash: '#a=shackleton-rim@2028-03&t=5&limits=14_72_72_1_1&mode=plan' })
    expect(back).toMatchObject({ page: 'app', a: { siteId: 'shackleton-rim', month: '2028-03' }, index: 5 })
  })

  it('gives the demo video its own address, and a view link leaves any page for the view', () => {
    expect(initialView('#demo')).toMatchObject({ page: 'demo', landing: false })
    const front = { ...initialView(''), sites: SITES }
    const video = viewReducer(front, { type: 'applyLink', hash: '#demo' })
    expect(video).toMatchObject({ page: 'demo', landing: false })
    const site = viewReducer(video, { type: 'applyLink', hash: '#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan' })
    expect(site).toMatchObject({ page: 'app', landing: false, a: { siteId: 'apollo-11', month: '2028-03' } })
    // From the front page too: following a link to a view leaves the front page.
    expect(viewReducer(front, { type: 'applyLink', hash: '#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan' }).landing).toBe(false)
  })

  it('leaves a running tour when another page is opened', () => {
    const touring = viewReducer({ ...initialView('#tour'), sites: SITES, a: { siteId: 'connecting-ridge', month: '2027-05' } }, { type: 'startTour', open3d: true })
    expect(touring.tour).not.toBeNull()
    expect(viewReducer(touring, { type: 'applyLink', hash: '#how' })).toMatchObject({ page: 'how', tour: null })
    expect(viewReducer(touring, { type: 'applyLink', hash: '#demo' })).toMatchObject({ page: 'demo', tour: null })
  })

  it('gives a shared plan its own address, and opening the plan leaves that page for its view', () => {
    expect(initialView('#plan=abcd2345')).toMatchObject({ page: 'plan', planId: 'abcd2345', landing: false })
    expect(initialView('#plan=nope')).toMatchObject({ page: 'app', planId: null })
    const front = { ...initialView(''), sites: SITES }
    const plan = viewReducer(front, { type: 'applyLink', hash: '#plan=wxyz6789' })
    expect(plan).toMatchObject({ page: 'plan', planId: 'wxyz6789', landing: false })
    const opened = viewReducer(plan, { type: 'applyLink', hash: '#a=shackleton-rim@2027-08&t=396&limits=14_72_72_1_1&mode=plan' })
    expect(opened).toMatchObject({ page: 'app', a: { siteId: 'shackleton-rim', month: '2027-08' }, index: 396 })
  })
})
