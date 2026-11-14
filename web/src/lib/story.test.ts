/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { HorizonPoint, SiteInfo, TrackPoint } from '../data/contract'
import { decodeRuns, type SiteFlags } from './flags'
import { checkOverview } from './testData'
import { monthShare, runLength, STORY, type StoryContext, stepDurationMs, sunExtremes } from './story'

const dataFile = <T,>(name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url))).toString(),
  ) as T

const overview = checkOverview()
const sites = dataFile<SiteInfo[]>('sites.json')
const flags: Record<string, SiteFlags> = Object.fromEntries(
  sites.map((site) => [
    site.id,
    {
      start: overview.start,
      sun: decodeRuns(overview.sites[site.id].sun, overview.hours),
      earth: decodeRuns(overview.sites[site.id].earth, overview.hours),
      earthAbove: {},
    },
  ]),
)
const places = Object.fromEntries(sites.map((site) => [site.id, site]))

function contextFor(siteId: string, month: string): StoryContext {
  return {
    track: dataFile<TrackPoint[]>(`${siteId}/${month}/track.json`),
    horizon: dataFile<HorizonPoint[]>(`${siteId}/horizon.json`),
    flags,
    places,
  }
}

const captions = STORY.map((step) => step.caption(contextFor(step.siteId, step.month)))

describe('the tour, on the real data', () => {
  it('prints sensible captions', () => {
    for (const caption of captions) {
      expect(caption).not.toMatch(/NaN|undefined|Infinity|null/)
      expect(caption.split(/\s+/).length).toBeLessThan(40)
    }
  })

  it('moves time only within each month', () => {
    for (const step of STORY) {
      const context = contextFor(step.siteId, step.month)
      const [from, to] = step.sweep(context)
      expect(from).toBeGreaterThanOrEqual(0)
      expect(to).toBeLessThan(context.track.length)
      expect(from).toBeLessThanOrEqual(to)
    }
  })

  it('takes about a minute', () => {
    const totalMs = captions.reduce((sum, caption) => sum + stepDurationMs(caption), 0)
    expect(totalMs).toBeGreaterThan(50_000)
    expect(totalMs).toBeLessThan(75_000)
  })

  it('says the Sun is high at Apollo 11 only because it is', () => {
    const track = contextFor('apollo-11', '2027-05').track
    expect(Math.max(...track.map((point) => point.sun_el))).toBeGreaterThan(80)
  })

  it('shows the Sun going down during the ridge scene', () => {
    const context = contextFor('shackleton-rim', '2027-05')
    const step = STORY.find((item) => item.id === 'ridges-decide')
    const [from, to] = step?.sweep(context) ?? [0, 0]
    expect(context.track[from].sun_up).toBe(true)
    expect(context.track[to].sun_up).toBe(false)
  })

  it('only contrasts two ridges if the gap is more than the model can blur', () => {
    const near = monthShare(flags['connecting-ridge'], '2027-05', 'sun')
    const far = monthShare(flags['shackleton-rim'], '2027-05', 'sun')
    // The site-comparison tolerance in compare.ts for these two ridges is at most about 4.2 points.
    expect(Math.abs(near - far)).toBeGreaterThan(4.2)
  })

  it('only contrasts two months if the gap is well beyond the same error', () => {
    const { low, high } = sunExtremes(flags['connecting-ridge'], 2027)
    const gap = monthShare(flags['connecting-ridge'], high, 'sun') - monthShare(flags['connecting-ridge'], low, 'sun')
    expect(gap).toBeGreaterThan(20)
  })

  it('logs the captions for review', () => {
    console.log(captions.join('\n'))
  })
})

describe('runLength', () => {
  it('measures the run around an hour', () => {
    expect(runLength([true, true, false, false, false, true], 3)).toBe(3)
    expect(runLength([true, true, false], 0)).toBe(2)
  })
})
