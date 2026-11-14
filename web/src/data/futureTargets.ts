import { useEffect, useState } from 'react'

/**
 * A place NASA names for a landing still to come (`pipeline/src/clps/future_targets.py`). NASA gives
 * the name and no coordinates, so the point is the IAU Gazetteer's centre for the named feature:
 * an approximate region, never a landing site.
 */
export interface FutureTarget {
  id: string
  name: string
  /** Who NASA says is going there, short enough for a list. */
  who: string
  /** NASA's own sentence naming the place, its page and the page's date. */
  says: string
  source_url: string
  source_date: string
  /** The Gazetteer feature whose centre this is, and its page there. */
  feature: string
  feature_url: string
  lat: number
  lon: number
}

let loading: Promise<FutureTarget[]> | null = null

/** The targets, fetched once; none if this build has no list. */
export function loadFutureTargets(): Promise<FutureTarget[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/future-targets.json`)
    .then((response) => (response.ok ? (response.json() as Promise<{ targets: FutureTarget[] }>) : { targets: [] }))
    .then((file) => file.targets)
    .catch(() => [])
  return loading
}

/** The targets, or none while they load. */
export function useFutureTargets(): FutureTarget[] {
  const [targets, setTargets] = useState<FutureTarget[]>([])
  useEffect(() => {
    let current = true
    void loadFutureTargets().then((found) => {
      if (current) setTargets(found)
    })
    return () => {
      current = false
    }
  }, [])
  return targets
}
