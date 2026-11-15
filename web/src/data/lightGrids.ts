import type { LightGrids } from '../lib/dataScale'

let loading: Promise<LightGrids | null> | null = null

/** The light grid's meta (its grids' sizes and the months they were computed for), fetched once; null if this build has no grid. */
export function loadLightGrids(): Promise<LightGrids | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/light/meta.json`)
    .then((response) => (response.ok ? (response.json() as Promise<LightGrids>) : null))
    .catch(() => null)
  return loading
}
