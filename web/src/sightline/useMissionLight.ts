import { useEffect, useState } from 'react'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { loadScenarioAt } from '../data/heights'
import { loadYearPositions } from '../data/loadSite'
import type { MissionHeights } from '../lib/heights'
import { locateHour } from '../lib/mission'
import { type LightHour, lightHours, type SunWhileUp, sunWhileUp } from '../lib/missionLight'
import type { YearSpan } from '../lib/span'
import { bodyRadiiDeg } from '../lib/surfaceView'

const HOUR_MS = 3_600_000

/** A mission's light, hour by hour from its landing. */
export interface MissionLight {
  hours: LightHour[]
  /** The Sun's elevation from level while it is up during the mission: its lowest and highest; null if it never is. */
  sunWhileUp: SunWhileUp | null
}

/**
 * The pipeline's hourly rows for the mission, read a month at a time, turned into the share of the
 * Sun's and of Earth's disc in view at each hour. Null when the mission runs past the data.
 */
async function loadMissionLight(site: SiteInfo, start: string, landing: number, missionH: number, years: YearSpan, heights: MissionHeights): Promise<MissionLight | null> {
  const rows: TrackPoint[] = []
  let earthHorizon: { az: number; el: number }[] | null = null
  while (rows.length < missionH) {
    const { month, index } = locateHour(start, landing + rows.length)
    // A mission that runs past the years on hand (a landing in the data's last days) has no chart:
    // that is expected, not a failure, so no month is asked for and nothing is logged as an error.
    const year = Number(month.slice(0, 4))
    if (year < years.from || year > years.to) return null
    const data = await loadScenarioAt(site, month, years, heights)
    earthHorizon ??= data.earthHorizon ?? data.horizon
    const part = data.track.slice(index, index + missionH - rows.length)
    if (part.length === 0) return null
    rows.push(...part)
  }
  if (!earthHorizon) return null
  // Earth's size from the Moon changes with its distance: its radius comes from each year's ephemeris file.
  const yearsTouched = [...new Set(rows.map((row) => Number(row.t.slice(0, 4))))]
  const positions = new Map(await Promise.all(yearsTouched.map(async (year) => [year, await loadYearPositions(year).catch(() => null)] as const)))
  const hours = lightHours(rows, earthHorizon, (point) => {
    const year = Number(point.t.slice(0, 4))
    const ofYear = positions.get(year)
    if (!ofYear) return null
    const hourOfYear = Math.round((Date.parse(point.t) - Date.UTC(year, 0, 1)) / HOUR_MS)
    return bodyRadiiDeg(ofYear, hourOfYear, site.lat, site.lon).earth
  })
  return { hours, sunWhileUp: sunWhileUp(rows) }
}

/**
 * The light over the mission of the scenario on show. Undefined while its months load; null when the
 * mission runs past the data or a month cannot be read. Nothing is asked for until `on` is true:
 * only the chart's panel shows it.
 */
export function useMissionLight(site: SiteInfo, landing: number, start: string, years: YearSpan, heights: MissionHeights, missionDays: number, on: boolean): MissionLight | null | undefined {
  const [loaded, setLoaded] = useState<{ key: string; light: MissionLight | null } | null>(null)
  const { panelM, antennaM } = heights
  const key = `${site.id}@${landing}+${missionDays}@${panelM}/${antennaM}@${years.from}-${years.to}`
  useEffect(() => {
    if (!on) return
    let current = true
    loadMissionLight(site, start, landing, missionDays * 24, years, { panelM, antennaM })
      .catch((reason: unknown) => {
        console.error(reason)
        return null
      })
      .then((light) => {
        if (current) setLoaded({ key, light })
      })
    return () => {
      current = false
    }
    // The key says everything that matters: the site, the landing hour, the mission's length, the two heights and the years on hand.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, start, on])
  return loaded?.key === key ? loaded.light : undefined
}
