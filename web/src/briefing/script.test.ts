import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { decodeRuns } from '../lib/flags'
import { type LightMetaFile, lightMeta, readMonth } from '../lib/lightGrid'
import { checkOverview } from '../lib/testData'
import type { Requirements } from '../lib/mission'
import type { PlannerSite } from '../planner/plannerModel'
import { A, B, C, MISSION } from '../planner/testSites'
import { buildBriefing, chapterMs, hourAt, recommend, shareWords } from './script'

const data = (path: string) => JSON.parse(readFileSync(new URL(`../../public/data/${path}`, import.meta.url), 'utf8')) as unknown

/** A made-up track: the Sun a little higher each hour, up for the first half of the month. */
function track(hours: number): TrackPoint[] {
  return Array.from({ length: hours }, (_, hour) => ({
    t: new Date(Date.UTC(2027, 0, 1, hour)).toISOString().replace('.000Z', 'Z'),
    sun_az: 0,
    sun_el: -1 + hour / 1000,
    sun_frac: 1,
    sun_up: hour < hours / 2,
    earth_az: 0,
    earth_el: 1,
    earth_up: true,
    sun_vec_me: [1, 0, 0],
  }))
}

describe('the briefing script', () => {
  it('words small shares so they never read as nothing', () => {
    expect(shareWords(0)).toBe('none')
    expect(shareWords(0.0004)).toBe('less than 0.1%')
    expect(shareWords(0.0012)).toBe('0.1%')
    expect(shareWords(0.034)).toBe('3.4%')
    expect(shareWords(0.03)).toBe('3%')
    expect(shareWords(0.412)).toBe('41%')
  })

  it('recommends the site whose best landing has the shortest time without the Sun', () => {
    // In January "a" has landings (ten days of Sun), "c" a few, "b" none.
    const pick = recommend([B, C, A], MISSION, '2027-01')
    expect(pick?.site.id).toBe('a')
    expect(pick?.inMonth).toBe(true)
    expect(pick?.landing.problems).toEqual([])
    expect(pick?.month).toBe('2027-01')
    expect(pick?.reasons[0]).toBe('Meets your limits')
  })

  it('says so when the month has no landing, and gives the first one after it', () => {
    // "c" has no Sun in February and nothing after; "a" does.
    const none = recommend([B, C], MISSION, '2027-02')
    expect(none).toBeNull()
    // In a month with no landing at "c", the first later landing anywhere is found, and marked as not in the month.
    const lateOnly: PlannerSite = { site: { ...A.site, id: 'late' }, flags: { ...A.flags, sun: A.flags.sun.map((_, t) => t >= 800) } }
    const later = recommend([B, lateOnly], MISSION, '2027-01')
    expect(later?.inMonth).toBe(false)
    expect(later?.site.id).toBe('late')
    expect(later?.month).toBe('2027-02')
    expect(later?.landing.hour).toBe(800)
  })

  it('builds chapters without the light grid, each number from the inputs', () => {
    const { chapters, recommendation } = buildBriefing({
      focus: A.site,
      month: '2027-01',
      hour: 100,
      track: track(744),
      requirements: MISSION,
      candidates: [A, B, C],
      grid: null,
      validation: null,
    })
    expect(chapters.map((chapter) => chapter.id)).toEqual(['question', 'month', 'sites', 'recommendation'])
    expect(chapters[0].caption).toContain('5 January 2027')
    // The Sun's highest point in the made-up track is -1 + 743/1000.
    expect(chapters[1].caption).toContain('At A it stays at least 0.3° below eye level')
    expect(chapters[1].hours).toEqual([0, 743])
    // Sun: a 68% (504 of January's 744 hours), b 0%, c 8% (60 hours); Earth is always up, so "both" is the same.
    expect(chapters[2].caption).toContain("We follow 3 ridges from NASA's published data: A, B and C.")
    expect(chapters[2].caption).toContain('the Sun for 0 to 68% of the hours, and the Sun and Earth together for 0 to 68%')
    const closing = chapters[3]
    expect(recommendation?.site.id).toBe('a')
    expect(closing.siteId).toBe('a')
    expect(closing.caption).toMatch(/^Our recommendation for a 2-day mission that can go 12 h without the Sun and 12 h without Earth: land at A on \d+ January 2027 at \d\d:00 UTC\. The Sun never sets during the mission, and Earth never leaves view\./)
    expect(closing.hours[0]).toBe(recommendation?.index)
  })

  it('moves time through a chapter and gives it time to be said', () => {
    const { chapters } = buildBriefing({ focus: A.site, month: '2027-01', hour: 100, track: track(744), requirements: MISSION, candidates: [A], grid: null, validation: null })
    const sweep = chapters[1]
    expect(hourAt(sweep, 0)).toBe(0)
    expect(hourAt(sweep, 0.5)).toBe(372)
    expect(hourAt(sweep, 2)).toBe(743)
    expect(hourAt(chapters[0], 0.7)).toBe(100)
    expect(chapterMs(chapters[0])).toBeGreaterThanOrEqual(9000)
    expect(chapterMs({ ...chapters[0], caption: 'Short.' })).toBe(9000)
  })
})

describe('the briefing on the real data', () => {
  const sites = data('sites.json') as SiteInfo[]
  const overview = checkOverview()
  const meta = lightMeta(data('light/meta.json') as LightMetaFile)
  const ridges: PlannerSite[] = sites
    .filter((site) => site.group === 'South pole ridges')
    .map((site) => {
      const runs = overview.sites[site.id]
      return { site, flags: { start: overview.start, sun: decodeRuns(runs.sun, overview.hours), earth: decodeRuns(runs.earth, overview.hours), earthAbove: {} } }
    })
  const limits: Requirements = { missionDays: 14, maxSunGapH: 72, maxEarthGapH: 72, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

  it('ends every month of the data on a landing that meets the limits, or says none does', () => {
    expect(ridges).toHaveLength(4)
    for (const month of Object.keys(meta.hours)) {
      const pick = recommend(ridges, limits, month)
      if (!pick) continue
      expect(pick.landing.problems).toEqual([])
      if (pick.inMonth) expect(pick.month).toBe(month)
      else expect(pick.month > month).toBe(true)
    }
  })

  it('tells the default view with the real numbers', () => {
    const focus = ridges[0].site
    const month = '2027-05'
    const points = data(`${focus.id}/${month}/track.json`) as TrackPoint[]
    // A tiny stand-in grid, so the grid chapters are built too; the real month file is not in Git.
    const small = { ...meta, size: 2, pixel_m: 120, half_width_m: 120 }
    const grid = { meta: small, month: readMonth(new Uint16Array(4 * 20).fill(744).buffer, { ...small, hours: { [month]: 744 } }, month) }
    const { chapters, recommendation } = buildBriefing({ focus, month, hour: 300, track: points, requirements: limits, candidates: ridges, grid, validation: { pixels: 1045007, sunMeanAbs: 1.23 } })
    expect(chapters.map((chapter) => chapter.id)).toEqual(['question', 'pole', 'month', 'both', 'sites', 'recommendation'])
    expect(chapters[0].caption).toContain('13 May 2027')
    for (const chapter of chapters) expect(chapter.caption).not.toMatch(/NaN|undefined|Infinity/)
    // May 2027 is the month with the least Sun at these ridges, and a landing late in it still works.
    expect(chapters[2].caption).toContain('At Connecting Ridge it stays at least 0.8° below eye level')
    expect(chapters[4].caption).toContain('the Sun for 52 to 62% of the hours, and the Sun and Earth together for 29 to 51%')
    expect(recommendation?.site.id).toBe('peak-near-shackleton')
    expect(recommendation?.landing.t).toBe('2027-05-28T14:00:00Z')
    expect(chapters[5].caption).toContain('land at Peak near Shackleton on 28 May 2027 at 14:00 UTC. The Sun is never gone for more than 2 h, and Earth for no more than 45 h. The landing can slip 1 day and still work.')
    // Short enough to say in two minutes: under 270 words in all, with the two grid-only chapters standing in.
    expect(chapters.map((chapter) => chapter.caption).join(' ').split(/\s+/).length).toBeLessThan(270)
  })
})
