import { useEffect, useMemo, useState } from 'react'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { loadYearPositions } from '../data/loadSite'
import { type BodyRadii, bodyRadiiDeg } from '../lib/surfaceView'

const HOUR_MS = 3_600_000

export interface BodySizes {
  /** The Sun's and Earth's angular radii for each hour of the track; null until they have loaded. */
  radii: BodyRadii[] | null
  failed: boolean
  retry: () => void
}

/**
 * How big the Sun and Earth look from the site at each hour of a month. The track has their
 * directions but not their distances, so the distances come from the pipeline's ephemeris file for
 * that year, and the radius is worked out from them the way the pipeline does.
 */
export function useBodySizes(site: SiteInfo | null, track: TrackPoint[] | null): BodySizes {
  const year = track ? Number(track[0].t.slice(0, 4)) : null
  const [loaded, setLoaded] = useState<{ year: number; positions: Float32Array | null } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (year === null) return
    let current = true
    loadYearPositions(year)
      .then((positions) => {
        if (current) setLoaded({ year, positions })
      })
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setLoaded({ year, positions: null })
      })
    return () => {
      current = false
    }
  }, [year, attempt])

  const known = loaded !== null && loaded.year === year
  const positions = known ? loaded.positions : null
  const radii = useMemo(() => {
    if (!site || !track || !positions) return null
    const yearStart = Date.UTC(Number(track[0].t.slice(0, 4)), 0, 1)
    return track.map((point) => bodyRadiiDeg(positions, Math.round((Date.parse(point.t) - yearStart) / HOUR_MS), site.lat, site.lon))
  }, [site, track, positions])

  return { radii, failed: known && positions === null, retry: () => setAttempt((count) => count + 1) }
}
