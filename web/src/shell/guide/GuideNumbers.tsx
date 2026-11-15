import { useEffect, useState } from 'react'
import { loadHorizonsCheck } from '../../data/horizonsCheck'
import { loadLightGrids } from '../../data/lightGrids'
import { loadLrocPhotos } from '../../data/loadSite'
import { scaleFigures } from '../../lib/dataScale'

interface Props {
  /** The hours and years the data covers; null while it loads. */
  range: { hours: number; first_year: number; last_year: number } | null
  siteCount: number
}

/** A file of the pipeline's, fetched once the strip is on the page; null until it is here or if the build has none. */
function useLoaded<T>(load: () => Promise<T | null>): T | null {
  const [found, setFound] = useState<T | null>(null)
  useEffect(() => {
    let current = true
    load()
      .then((loaded) => {
        if (current) setFound(loaded)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [load])
  return found
}

/**
 * "By the numbers": how much NASA data the model works through, as six plain counts. Each is worked
 * out from the pipeline's own files as the page reads them (lib/dataScale.ts); a figure whose file
 * is not here yet shows as "…", never as a guess.
 */
export function GuideNumbers({ range, siteCount }: Props) {
  const light = useLoaded(loadLightGrids)
  const horizons = useLoaded(loadHorizonsCheck)
  const photos = useLoaded(loadLrocPhotos)
  return (
    <section className="how-numbers" aria-labelledby="how-numbers-title">
      <h3 id="how-numbers-title">By the numbers</h3>
      <dl className="how-number-list">
        {scaleFigures({ range, siteCount, light, horizons, photos }).map((entry) => (
          <div key={entry.id} data-figure={entry.id}>
            <dt>{entry.figure ?? '…'}</dt>
            <dd>{entry.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
