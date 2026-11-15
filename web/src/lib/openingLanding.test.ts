import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { HorizonPoint, TrackPoint } from '../data/contract'
import { horizonAt } from './customModel'
import { hourOf, NO_GAP_LIMIT_H } from './mission'
import { marginalHour, type SightlineMission } from './sightlineMission'
import { siteData } from '../../shared/tools/data'
import { firstFitFrom, fitsAt, goodLandingFrom } from './openingLanding'

// Against the pipeline's real output: the files the page itself reads.
const dir = fileURLToPath(new URL('../../public/data', import.meta.url))
const data = siteData(dir)
const MISSION = { requirements: { missionDays: 14, maxSunGapH: 24, maxEarthGapH: NO_GAP_LIMIT_H, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }, maxSlopeDeg: 10, heights: { panelM: 2, antennaM: 2 } } as SightlineMission
const month = (site: string) => async (name: string) => {
  const track = JSON.parse(readFileSync(`${dir}/${site}/${name}/track.json`, 'utf8')) as TrackPoint[]
  const horizon = JSON.parse(readFileSync(`${dir}/${site}/horizon.json`, 'utf8')) as HorizonPoint[]
  return { track, horizon }
}

describe('the landing Plan opens on', () => {
  it('is the next one from the real hour that fits with margin: never a marginal fit, never before that hour', async () => {
    const flags = await data.flags('connecting-ridge')
    for (const iso of ['2026-11-15T08:00:00Z', '2026-12-11T00:00:00Z', '2027-01-12T00:00:00Z', '2027-05-01T00:00:00Z']) {
      const from = hourOf(flags.start, iso)
      const good = await goodLandingFrom(flags, from, MISSION, month('connecting-ridge'))
      expect(good, iso).not.toBeNull()
      if (!good) continue
      expect(good.marginal, iso).toBe(false)
      expect(good.landing, iso).toBeGreaterThanOrEqual(from)
      expect(fitsAt(flags, good.landing, MISSION), iso).toBe(true)
      // The screen's own rule calls it a plain fit at that hour.
      const at = new Date(Date.parse(flags.start) + good.landing * 3_600_000).toISOString()
      const sky = await month('connecting-ridge')(at.slice(0, 7))
      const index = (Date.parse(at) - Date.parse(`${at.slice(0, 7)}-01T00:00:00Z`)) / 3_600_000
      const earthAbove = sky.track.map((point) => point.earth_el - horizonAt(sky.horizon, point.earth_az) >= 0)
      expect(marginalHour(MISSION.requirements, sky.track.map((point) => point.sun_frac), earthAbove, index), iso).toBe(false)
    }
  })

  it('is at or after the first hour the flags alone allow, which is where Plan opens before the month has loaded', async () => {
    const flags = await data.flags('connecting-ridge')
    const from = hourOf(flags.start, '2026-12-11T00:00:00Z')
    const first = firstFitFrom(flags, from, MISSION)
    const good = await goodLandingFrom(flags, from, MISSION, month('connecting-ridge'))
    expect(first).not.toBeNull()
    expect(good?.landing ?? -1).toBeGreaterThanOrEqual(first ?? 0)
  })

  it('says so when nothing in the data fits', async () => {
    const flags = await data.flags('im-1-odysseus')
    const none = await goodLandingFrom(flags, hourOf(flags.start, '2027-05-01T00:00:00Z'), MISSION, month('im-1-odysseus'))
    expect(none).toBeNull()
  })
})
