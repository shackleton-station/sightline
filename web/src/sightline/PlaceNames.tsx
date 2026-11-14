import { useMemo } from 'react'
import type { MoonFeatures } from '../data/contract'
import { fitNames, markerBoxes, nameCandidates, type NamedMarker } from '../lib/placeNames'
import './placeNames.css'

interface Props {
  features: MoonFeatures
  /** The globe's camera: where a latitude and longitude lies on the disc, and how squarely it faces us. */
  place: (lat: number, lon: number) => { x: number; y: number; facing: number }
  zoom: number
  /** The globe's square, in pixels across. */
  side: number
  /** The site markers on the globe: names keep clear of them and of their own names. */
  markers: NamedMarker[]
}

/**
 * The "Place names" layer on the Moon: the IAU's names for its large features, and the earlier
 * landings the site list does not hold, printed where they are. They follow the Moon as it turns
 * and zooms, keep clear of the sites, and take no clicks: a press on one reaches the Moon under it.
 */
export function PlaceNames({ features, place, zoom, side, markers }: Props) {
  const names = useMemo(() => fitNames(nameCandidates(features, place, zoom, side), side, markerBoxes(markers), zoom * side), [features, place, zoom, side, markers])
  return (
    <div className="sl-place-names" aria-hidden="true" data-count={names.length}>
      {names.map((name) => (
        <span key={name.key} className={`sl-place-name is-${name.kind}`} style={{ left: name.x, top: name.y }}>
          {name.text}
        </span>
      ))}
    </div>
  )
}
