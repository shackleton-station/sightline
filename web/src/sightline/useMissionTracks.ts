import { useEffect, useState } from 'react'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { isCustomSite } from '../data/customSite'
import { loadScenario, loadTrack } from '../data/loadSite'
import { locateHour } from '../lib/mission'
import type { SightlineScenario } from '../lib/sightlineMission'

/** The months ("YYYY-MM") the hours from `from` to `to` fall in, in order. */
function monthsBetween(start: string, from: number, to: number): string[] {
  const months: string[] = []
  for (let h = from; h <= to; h += 24) months.push(locateHour(start, h).month)
  months.push(locateHour(start, to).month)
  return [...new Set(months)]
}

/** One scenario's mission, hour by hour from its landing: the pipeline's own track, at 2 m. */
async function missionTrack(site: SiteInfo, start: string, landing: number, hours: number): Promise<TrackPoint[]> {
  const months = monthsBetween(start, landing, landing + hours - 1)
  const parts = isCustomSite(site) ? await Promise.all(months.map((month) => loadScenario(site, month).then((data) => data.track))) : await Promise.all(months.map((month) => loadTrack(site, month)))
  const fromMs = Date.parse(start) + landing * 3_600_000
  const toMs = fromMs + (hours - 1) * 3_600_000
  return parts.flat().filter((point) => {
    const ms = Date.parse(point.t)
    return ms >= fromMs && ms <= toMs
  })
}

/**
 * Each scenario's mission track, for Compare's Sun chart and power budget: undefined while it loads,
 * null if it failed. Loaded once per scenario, site and mission length; the files are cached.
 */
export function useMissionTracks(start: string, dataHours: number, scenarios: SightlineScenario[], sites: SiteInfo[], missionDays: number): (TrackPoint[] | null | undefined)[] {
  // Never past the data's last hour: a month file that doesn't exist reads as a stale build.
  const hoursOf = (landing: number) => Math.max(1, Math.min(missionDays * 24, dataHours - landing))
  const keys = scenarios.map((scenario, i) => `${sites[i]?.id}@${scenario.landing}@${hoursOf(scenario.landing)}`)
  const [loaded, setLoaded] = useState<Record<string, TrackPoint[] | null>>({})
  const wanted = keys.join('|')
  useEffect(() => {
    let current = true
    scenarios.forEach((scenario, i) => {
      const site = sites[i]
      const key = keys[i]
      if (!site || key in loaded) return
      missionTrack(site, start, scenario.landing, hoursOf(scenario.landing))
        .then((track) => current && setLoaded((before) => ({ ...before, [key]: track })))
        .catch((reason: unknown) => {
          console.error(reason)
          if (current) setLoaded((before) => ({ ...before, [key]: null }))
        })
    })
    return () => {
      current = false
    }
    // `wanted` stands for the scenarios, sites and mission length together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, start])
  return keys.map((key) => (key in loaded ? loaded[key] : undefined))
}
