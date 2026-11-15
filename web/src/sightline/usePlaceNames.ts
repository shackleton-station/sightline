import { useEffect, useState } from 'react'
import type { MoonFeatures } from '../data/contract'
import { loadFeatures } from '../data/loadSite'

/** The names file, and whether it has arrived: asked for the first time the layer is switched on. */
export interface PlaceNamesState {
  features: MoonFeatures | null
  state: 'off' | 'loading' | 'ready' | 'failed'
}

/**
 * The names for the "Place names" layer. Nothing is fetched until the layer is first switched on;
 * after that the file is on hand. After a failure, switching the layer off and on asks once more.
 */
export function usePlaceNames(on: boolean): PlaceNamesState {
  const [features, setFeatures] = useState<MoonFeatures | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!on || features) return
    let current = true
    loadFeatures().then(
      (loaded) => {
        if (!current) return
        setFeatures(loaded)
        setFailed(false)
      },
      (reason: unknown) => {
        console.error(reason)
        if (current) setFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [on, features])
  return { features: on ? features : null, state: !on ? 'off' : features ? 'ready' : failed ? 'failed' : 'loading' }
}
