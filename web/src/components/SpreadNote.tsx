import { useEffect, useState } from 'react'
import type { SiteSpread } from '../data/contract'
import { loadSpread, type ScenarioData } from '../data/loadSite'
import { spreadSentence, terrainErrorSentence } from '../lib/spread'

interface Props {
  data: ScenarioData
  /** Show the terrain error too, for those weighing the numbers closely. */
  plan: boolean
}

/** At a ridge site, one number hides a lot: this says how much it changes close by. */
export function SpreadNote({ data, plan }: Props) {
  const [loaded, setLoaded] = useState<{ siteId: string; spread: SiteSpread | null } | null>(null)

  useEffect(() => {
    let current = true
    loadSpread(data.site)
      .then((spread) => {
        if (current) setLoaded({ siteId: data.site.id, spread })
      })
      // The month's own numbers still stand; this only qualifies them.
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [data.site])

  const spread = loaded?.siteId === data.site.id ? loaded.spread : null
  if (!spread) return null
  const sentence = spreadSentence(spread, data.month, data.summary)
  return (
    <div className="spread">
      {sentence && <p>{sentence}</p>}
      {plan && <p className="note">{terrainErrorSentence(spread)}</p>}
    </div>
  )
}
