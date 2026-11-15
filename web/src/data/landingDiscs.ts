import { useEffect, useState } from 'react'
import { horizonAt } from '../lib/customModel'
import { earthShare } from '../lib/sightlineSky'
import { bodyRadiiDeg } from '../lib/surfaceView'
import type { DiscsAtLanding } from '../lib/landingVerdict'
import type { SiteInfo } from './contract'
import { loadScenario, loadYearPositions, type ScenarioData } from './loadSite'

const HOUR_MS = 3_600_000

type YearPositions = Awaited<ReturnType<typeof loadYearPositions>>

/**
 * How much of the Sun's and of Earth's disc is in view at one hour of a site's month, with each
 * one's elevation: from level, and above the skyline in its own direction (its center; negative
 * when the skyline hides it). The Sun's share is the pipeline's own (`sun_frac`). Earth's is worked
 * out the same way, from how far its center is above the skyline and its angular radius at that
 * hour; null where the year's positions could not be read.
 */
export function discsAt(data: ScenarioData, index: number, positions: YearPositions | null, site: SiteInfo) {
  const point = data.track[Math.min(index, data.track.length - 1)]
  const year = Number(data.month.slice(0, 4))
  const hourOfYear = Math.round((Date.parse(point.t) - Date.UTC(year, 0, 1)) / HOUR_MS)
  const sunAboveDeg = point.sun_el - horizonAt(data.horizon, point.sun_az)
  const earthAboveDeg = point.earth_el - horizonAt(data.earthHorizon ?? data.horizon, point.earth_az)
  const earth = positions ? earthShare(earthAboveDeg, bodyRadiiDeg(positions, hourOfYear, site.lat, site.lon).earth) : null
  return { sun: point.sun_frac, earth, earthUp: point.earth_up, sunElDeg: point.sun_el, earthElDeg: point.earth_el, sunAboveDeg, earthAboveDeg }
}

/**
 * The discs at a landing for a listed site at the app's own 2 m, from its hour as an ISO time: what
 * the written brief needs to give a landing the plan column's verdict. Null while it loads, or if
 * it cannot be read; a landing that fits is then simply not called marginal.
 */
export function useDiscsAtLanding(site: SiteInfo, t: string): DiscsAtLanding | null {
  const [found, setFound] = useState<{ key: string; discs: DiscsAtLanding } | null>(null)
  const key = `${site.id}@${t}`
  useEffect(() => {
    let current = true
    const month = t.slice(0, 7)
    const index = Math.round((Date.parse(t) - Date.parse(`${month}-01T00:00:00Z`)) / HOUR_MS)
    Promise.all([loadScenario(site, month), loadYearPositions(Number(month.slice(0, 4))).catch(() => null)])
      .then(([data, positions]) => {
        if (current) setFound({ key, discs: discsAt(data, index, positions, site) })
      })
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
    // The key says everything that matters: the site and the landing's hour.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return found && found.key === key ? found.discs : null
}
