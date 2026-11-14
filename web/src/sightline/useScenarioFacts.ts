import { useEffect, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { loadScenarioAt } from '../data/heights'
import { loadScenario, loadSiteFlags, loadYearPositions } from '../data/loadSite'
import type { FlaggedSite } from '../data/useAllFlags'
import { horizonAt } from '../lib/customModel'
import type { SiteFlags } from '../lib/flags'
import type { MissionHeights } from '../lib/heights'
import { locateHour } from '../lib/mission'
import { spanOfHours, type YearSpan } from '../lib/span'
import type { SightlineScenario } from '../lib/sightlineMission'
import { earthShare } from '../lib/sightlineSky'
import { bodyRadiiDeg } from '../lib/surfaceView'
import { useFutureTargets } from '../data/futureTargets'
import { siteFor } from './site'

/** What every scenario needs wherever it is shown: its site, the site's hourly flags and its slope. */
export interface ScenarioFacts {
  site: SiteInfo
  /** Null while a custom point is worked out in the browser. */
  flags: SiteFlags | null
  /** The ground's slope in degrees, from LOLA; null if unknown or not yet worked out. */
  slopeDeg: number | null
}

/**
 * The facts for each scenario, in order. Listed sites have theirs on hand already; a custom point's
 * are worked out once for the years on hand and kept, so going back to it costs nothing. When more
 * years arrive, a custom point is worked out again over them.
 */
export function useScenarioFacts(sites: SiteInfo[], flagged: FlaggedSite[], scenarios: SightlineScenario[], start: string): ScenarioFacts[] {
  const [worked, setWorked] = useState<Record<string, { flags: SiteFlags; slopeDeg: number | null }>>({})
  // Only the sites matter here, not the dates: moving a landing must not redo any of this.
  const key = scenarios.map((scenario) => scenario.site).join('|')
  // The years the listed sites' flags cover: a custom point's must cover the same, hour for hour.
  const hours = flagged[0].flags.sun.length
  const years = useMemo(() => spanOfHours(start, hours), [start, hours])
  const held = `${years.from}-${years.to}`
  // A point that is one of NASA's future targets is named for it.
  const targets = useFutureTargets()
  const resolved = useMemo(
    () => key.split('|').map((value) => siteFor(sites, value, targets) ?? sites[0]),
    [sites, key, targets],
  )

  // A month the point's model can be asked for: the first scenario's that names it.
  const months = scenarios.map((scenario) => locateHour(start, scenario.landing).month).join('|')
  useEffect(() => {
    let current = true
    const monthOf = months.split('|')
    resolved.forEach((site, i) => {
      if (!isCustomSite(site)) return
      Promise.all([loadSiteFlags(site, years), loadScenario(site, monthOf[i], years)])
        .then(([flags, data]) => {
          const id = `${site.id}@${held}`
          if (current) setWorked((before) => (before[id] ? before : { ...before, [id]: { flags, slopeDeg: data.slope?.deg ?? null } }))
        })
        // The column says why the point can't be worked out; here it just stays without numbers.
        .catch((reason: unknown) => console.error(reason))
    })
    return () => {
      current = false
    }
    // The months only pick which month to ask a new point's model for; a moved landing starts nothing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, held])

  return useMemo(
    () =>
      resolved.map((site) => {
        if (isCustomSite(site)) return { site, flags: worked[`${site.id}@${held}`]?.flags ?? null, slopeDeg: worked[`${site.id}@${held}`]?.slopeDeg ?? null }
        return { site, flags: flagged.find((entry) => entry.site.id === site.id)?.flags ?? null, slopeDeg: site.slope?.deg ?? null }
      }),
    [resolved, worked, flagged, held],
  )
}

/**
 * A landing's hour: how much of the Sun's and of Earth's disc is in view (Earth's is null where its
 * size could not be read), and each one's elevation from level, in degrees, from the pipeline's track.
 */
export interface LandingShares {
  sun: number
  earth: number | null
  earthUp: boolean
  sunElDeg: number
  earthElDeg: number
}

const HOUR_MS = 3_600_000

/**
 * The share of the Sun's and Earth's discs in view at each scenario's landing. The Sun's is the
 * pipeline's own (`sun_frac`). Earth's is worked out the same way, from how far Earth's centre is
 * above the skyline in the pipeline's track and horizon, and Earth's angular radius at that hour
 * from the year's ephemeris file. Null while a scenario's month loads, or if it cannot be read.
 */
export function useLandingShares(scenarios: SightlineScenario[], facts: ScenarioFacts[], start: string, years: YearSpan, heights: MissionHeights): (LandingShares | null)[] {
  const [shares, setShares] = useState<Record<string, LandingShares>>({})
  const { panelM, antennaM } = heights
  const keys = scenarios.map((scenario, i) => `${facts[i].site.id}@${scenario.landing}@${panelM}/${antennaM}`)
  const wanted = keys.join('|')
  useEffect(() => {
    let current = true
    scenarios.forEach((scenario, i) => {
      const key = keys[i]
      const site = facts[i].site
      const { month, index } = locateHour(start, scenario.landing)
      const year = Number(month.slice(0, 4))
      Promise.all([loadScenarioAt(site, month, years, { panelM, antennaM }), loadYearPositions(year).catch(() => null)])
        .then(([data, positions]) => {
          const point = data.track[Math.min(index, data.track.length - 1)]
          const hourOfYear = Math.round((Date.parse(point.t) - Date.UTC(year, 0, 1)) / HOUR_MS)
          const earth = positions ? earthShare(point.earth_el - horizonAt(data.earthHorizon ?? data.horizon, point.earth_az), bodyRadiiDeg(positions, hourOfYear, site.lat, site.lon).earth) : null
          if (current) setShares((before) => ({ ...before, [key]: { sun: point.sun_frac, earth, earthUp: point.earth_up, sunElDeg: point.sun_el, earthElDeg: point.earth_el } }))
        })
        // Without the shares a landing that fits is simply not called marginal.
        .catch((reason: unknown) => console.error(reason))
    })
    return () => {
      current = false
    }
    // The keys say everything that matters: each scenario's site and landing hour, and the two heights. The years on hand only say which of a site's files hold its yearly numbers.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, start, years.from, years.to])
  return keys.map((key) => shares[key] ?? null)
}
