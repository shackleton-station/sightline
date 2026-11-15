import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { OverviewYear } from '../../src/data/contract'
import type { Bucket } from '../../shared/bucket'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteData } from '../../shared/tools/data'
import { viewFrom } from './actions'
import { systemPrompt } from './prompt'
import { scenarioScene } from './scenarios'

// Against the pipeline's real output, so the figures are the ones the page's Compare table shows.
const data = siteData(fileURLToPath(new URL('../../public/data', import.meta.url)))
/** Sightline with two scenarios, the second on show: A is Connecting Ridge and B is Shackleton Rim, both landing 6 May 2027 at 13:00. */
const TWO = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&sc=1'

describe('scenarioScene', () => {
  it('names the scenario on show and makes it the view', async () => {
    const scene = await scenarioScene(TWO, viewFrom(TWO), data)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('scenario_on_screen')).toBe('B: Shackleton Rim, landing 6 May 2027, 13:00 UTC')
    expect(value('scenario_count')).toBe('2')
    expect(value('scenario_a')).toBe('Connecting Ridge, landing 6 May 2027, 13:00 UTC')
    expect(scene?.view.a).toEqual({ site: 'shackleton-rim', month: '2027-05' })
    expect(scene?.view.index).toBe(133)
    // The other scenario stays with the view, so a button can still open it.
    expect(scene?.view.shortlist).toEqual([{ site: 'connecting-ridge', at: '2027-05-06T13' }])
  })

  it("gives each scenario the figures of the page's Compare table", async () => {
    const scene = await scenarioScene(TWO, viewFrom(TWO), data)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('scenario_a_sunlit_share_of_mission')).toBe('61%')
    expect(value('scenario_a_longest_time_without_sun')).toBe('95 h')
    expect(value('scenario_a_earth_in_view_share_of_mission')).toBe('50%')
    expect(value('scenario_a_longest_time_without_earth')).toBe('169 h')
    expect(value('scenario_a_ground_slope')).toBe('1.2°')
    expect(value('scenario_b_sunlit_share_of_mission')).toBe('66%')
    expect(value('scenario_b_longest_time_without_sun')).toBe('79 h')
    expect(value('scenario_b_verdict')).toBe('does not meet the mission limits')
    expect(value('scenario_b_reason_1')).toMatch(/^the Sun is gone for 79 h/)
  })

  it('with one scenario still says which is on screen', async () => {
    const one = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&sc=0'
    const scene = await scenarioScene(one, viewFrom(one), data)
    expect(scene?.facts.find((item) => item.key === 'scenario_on_screen')?.value).toMatch(/^A: Connecting Ridge/)
    expect(scene?.view.shortlist).toEqual([])
  })

  it('for the scenario on show that does not fit, names the other site the screen offers for the same date', async () => {
    const first = '#a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1&mode=plan&sc=0'
    const scene = await scenarioScene(first, viewFrom(first), data)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('scenario_a_verdict')).toMatch(/^does not meet the mission limits/)
    expect(value('scenario_a_fits_at_another_site')).toBe('Peak near Shackleton, 42 km away')
    // On a date that fits at no ridge site it says so, and only for the scenario on show.
    const none = await scenarioScene(TWO, viewFrom(TWO), data)
    expect(none?.facts.find((item) => item.key === 'scenario_b_fits_at_another_site')?.value).toBe('none: on this date no other site of the group meets them')
    expect(none?.facts.find((item) => item.key === 'scenario_a_fits_at_another_site')).toBeUndefined()
  })

  it("leaves another page's link alone", async () => {
    const other = '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn'
    expect(await scenarioScene(other, viewFrom(other), data)).toBeNull()
    expect(await scenarioScene(undefined, viewFrom(other), data)).toBeNull()
  })
})

describe('scenarioScene with heights chosen for the solar panel and the antenna', () => {
  const HIGH = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&hp=10&ha=4&sc=0'
  const dataDir = fileURLToPath(new URL('../../public/data', import.meta.url))
  /** A bucket holding the other heights' overviews: the app's own, with the Sun always up at Connecting Ridge from 10 m. */
  const bucket: Bucket = {
    async get(key) {
      const match = /^tiles\/light\/heights\/(4|10)m\/overview\/(\d{4})\.json\.gz$/.exec(key)
      if (!match) return null
      const year = JSON.parse(readFileSync(`${dataDir}/overview/${match[2]}.json`, 'utf8')) as OverviewYear
      if (match[1] === '10') year.sites['connecting-ridge'].sun = [0, year.hours]
      const body = gzipSync(JSON.stringify(year))
      return { status: 200, body: new Response(body).body, length: String(body.length), contentRange: null, etag: null }
    },
  }

  it('says the heights, and works the figures out at them when their files can be read', async () => {
    const scene = await scenarioScene(HIGH, viewFrom(HIGH), siteData(dataDir, bucket))
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('heights_above_ground')).toMatch(/^panel at 10 m, antenna at 4 m\. The scenario figures here are for these heights, as on the visitor's screen\. Every tool's numbers are for 2 m/)
    // The Sun from the 10 m set (always up in this stand-in), Earth from the 4 m set (the app's own figures here).
    expect(value('scenario_a_sunlit_share_of_mission')).toBe('100%')
    expect(value('scenario_a_longest_time_without_sun')).toBe('0 h')
    expect(value('scenario_a_earth_in_view_share_of_mission')).toBe('50%')
    expect(value('scenario_a_verdict')).toBe('meets the mission limits')
  })

  it('falls back to the 2 m figures, and says so, when those files cannot be read', async () => {
    const scene = await scenarioScene(HIGH, viewFrom(HIGH), data)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('heights_above_ground')).toMatch(/The scenario figures here are for 2 m, so the visitor's screen can show a little more Sun or Earth\./)
    expect(value('scenario_a_sunlit_share_of_mission')).toBe('61%')
    expect(value('scenario_a_longest_time_without_sun')).toBe('95 h')
  })

  it('says nothing about heights at the app\'s own 2 m', async () => {
    const scene = await scenarioScene(TWO, viewFrom(TWO), siteData(dataDir, bucket))
    expect(scene?.facts.some((item) => item.key === 'heights_above_ground')).toBe(false)
  })
})

describe('the instructions', () => {
  it('say to answer about the scenario on screen and never to offer a landing that is already a scenario', () => {
    const rules = systemPrompt({ first_year: 2026, last_year: 2049 })
    expect(rules).toMatch(/Answer about the scenario on screen unless they ask about another/)
    expect(rules).toMatch(/Never offer, as a new landing or a better date, a site and time that is already one of the visitor's scenarios/)
  })
})
