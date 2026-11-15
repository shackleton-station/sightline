import { useEffect, useState } from 'react'
import { loadLightGrids } from '../data/lightGrids'
import { type LightGrids, scaleHeadline } from '../lib/dataScale'

/**
 * One quiet line under the first screen's caption: how many Sun and Earth answers stand behind the
 * picture, counted from the data's own files. Nothing is shown until the count is known, and
 * nothing on a phone, where the top of the screen is already full.
 */
export function BrandScale({ range, siteCount }: { range: { hours: number }; siteCount: number }) {
  const [light, setLight] = useState<LightGrids | null>(null)
  useEffect(() => {
    let current = true
    void loadLightGrids().then((found) => {
      if (current) setLight(found)
    })
    return () => {
      current = false
    }
  }, [])
  const line = light ? scaleHeadline(light, siteCount, range.hours) : null
  return line ? <p className="sl-brand-scale">{line}</p> : null
}
