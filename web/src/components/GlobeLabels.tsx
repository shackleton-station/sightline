import { useMemo } from 'react'
import type { MoonFeatures } from '../data/contract'
import { diskStyle, fitLabels, type LabelCandidate, toCanvas } from '../lib/globe'

interface Props {
  features: MoonFeatures
  /** Where a place lands on the disk at zoom 1, from the globe's camera. */
  place: (lat: number, lon: number) => { x: number; y: number; facing: number }
  zoom?: number
  sizePx: number
}

/** Labels hide toward the rim, where they'd squeeze together. */
const MIN_FACING = 0.25

interface Candidate extends LabelCandidate {
  kind: string
}

/**
 * IAU place names and past landings on the globe, for finding your way around. Not clickable.
 * Past landings come first, then the widest features, and any label that would overlap is left out.
 */
export function GlobeLabels({ features, place, zoom = 1, sizePx }: Props) {
  const labels = useMemo(() => {
    const candidates: Candidate[] = []
    const add = (key: string, text: string, kind: string, lat: number, lon: number) => {
      const p = place(lat, lon)
      const c = toCanvas(p, zoom)
      if (p.facing >= MIN_FACING && c.inside) candidates.push({ key, text, kind, x: c.x, y: c.y })
    }
    for (const landing of features.landings) {
      add(`l:${landing.name}`, landing.name, 'landing', landing.lat, landing.lon)
    }
    for (const name of features.names) add(`n:${name.name}`, name.name, name.kind, name.lat, name.lon)
    const kept = fitLabels(candidates, sizePx)
    return candidates.filter((c) => kept.has(c.key))
  }, [features, place, zoom, sizePx])

  return (
    <div className="globe-labels" aria-hidden="true">
      {labels.map((label) => (
        <span key={label.key} className={`globe-label ${label.kind}`} style={diskStyle(label.x, label.y)}>
          {label.text}
        </span>
      ))}
    </div>
  )
}
