import { useEffect, useState } from 'react'

/** One site's hour-for-hour comparison with JPL Horizons (`pipeline/scripts/compare_horizons.py`). */
export interface HorizonsSiteCheck {
  /** Hours compared, for each of the Sun and Earth. */
  hours: number
  /** The largest and the typical (median) gap between Horizons and the hourly angles the app ships, in degrees. */
  max_deg: number
  typical_deg: number
  /** The observer's height above Horizons' 1737.4 km sphere, in km: what a query for this site must give. */
  alt_km: number
}

export interface HorizonsCheck {
  /** The ephemeris Horizons said it used. */
  ephemeris: string | null
  /** The day the comparison was run. */
  made: string
  sites: Record<string, HorizonsSiteCheck>
}

let loading: Promise<HorizonsCheck | null> | null = null

/** The comparison file, fetched once; null if this build has none. */
export function loadHorizonsCheck(): Promise<HorizonsCheck | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/horizons.json`)
    .then((response) => (response.ok ? (response.json() as Promise<HorizonsCheck>) : null))
    .catch(() => null)
  return loading
}

/** The comparison for one site, or null while it loads, for a custom point, or if there is none. */
export function useHorizonsCheck(siteId: string | null): HorizonsSiteCheck | null {
  const [check, setCheck] = useState<HorizonsCheck | null>(null)
  useEffect(() => {
    let current = true
    void loadHorizonsCheck().then((found) => {
      if (current) setCheck(found)
    })
    return () => {
      current = false
    }
  }, [])
  return (siteId && check?.sites[siteId]) || null
}
