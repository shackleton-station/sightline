import { useCallback, useEffect, useState } from 'react'
import { loadOverview, loadSiteFlags, loadSites } from '../data/loadSite'
import type { PlannerSite } from './plannerModel'

interface Loaded {
  sites: PlannerSite[]
  /** How far above the ground the pipeline's observer stands, in meters. */
  obsHeightM: number
}

export type PlannerData =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | ({ status: 'ready' } & Loaded)

/**
 * Every listed site with its hourly Sun and Earth flags for the whole span of the data: one small
 * file. Unlike the other pages' loaders, a failure is reported, so the page can offer to try again.
 */
export function usePlannerData(): PlannerData {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ attempt: number; loaded: Loaded | null } | null>(null)

  useEffect(() => {
    let current = true
    Promise.all([loadSites(), loadOverview()])
      .then(async ([list, overview]) => {
        const sites = await Promise.all(list.map(async (site) => ({ site, flags: await loadSiteFlags(site) })))
        if (current) setResult({ attempt, loaded: { sites, obsHeightM: overview.obs_height_m } })
      })
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setResult({ attempt, loaded: null })
      })
    return () => {
      current = false
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])
  if (result?.attempt !== attempt) return { status: 'loading' }
  return result.loaded ? { status: 'ready', ...result.loaded } : { status: 'error', retry }
}
