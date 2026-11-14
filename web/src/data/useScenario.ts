import { useEffect, useState } from 'react'
import type { YearSpan } from '../lib/span'
import type { SiteInfo } from './contract'
import { DEFAULT_HEIGHTS, type MissionHeights } from '../lib/heights'
import { loadScenarioAt } from './heights'
import type { ScenarioData } from './loadSite'

interface ScenarioState {
  data: ScenarioData | null
  error: string | null
  /** True while a new site or month loads; the previous data keeps showing until then. */
  loading: boolean
}

/**
 * Load a site and month. Keeps showing the previous data until the new data arrives. The yearly
 * numbers are for the page's own years, or for `span` when a page holds years of its own choosing.
 * With `heights` other than the app's own 2 m (Sightline's choice), the Sun's rows come from the
 * panel's height and Earth's from the antenna's.
 */
export function useScenario(site: SiteInfo | null, month: string, span?: YearSpan, heights: MissionHeights = DEFAULT_HEIGHTS): ScenarioState {
  const [state, setState] = useState<ScenarioState>({ data: null, error: null, loading: false })
  // The heights by value: a caller may make a new object on every render.
  const { panelM, antennaM } = heights

  useEffect(() => {
    if (!site) {
      // Nothing is on show, so nothing old should appear when something opens again.
      setState({ data: null, error: null, loading: false })
      return
    }
    let current = true
    // Give the browser a moment to paint "loading" before a custom point's calculation runs.
    const timer = setTimeout(() => {
      if (current) setState((previous) => ({ ...previous, loading: true }))
    }, 0)
    loadScenarioAt(site, month, span, { panelM, antennaM })
      .then((data) => {
        clearTimeout(timer)
        if (current) setState({ data, error: null, loading: false })
      })
      .catch((reason: unknown) => {
        clearTimeout(timer)
        if (current) {
          setState((previous) => ({ data: previous.data, error: String(reason), loading: false }))
        }
      })
    return () => {
      current = false
      clearTimeout(timer)
    }
    // The span's years, not the object: a caller may make a new one on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [site, month, span?.from, span?.to, panelM, antennaM])

  return state
}
