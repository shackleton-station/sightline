import { useEffect, useRef, useState } from 'react'
import type { MoonFeatures, SiteInfo, TrackPoint } from '../data/contract'
import { loadFeatures } from '../data/loadSite'
import { diskStyle, toCanvas } from '../lib/globe'
import { GlobeCanvas } from './GlobeCanvas'
import { GlobeLabels } from './GlobeLabels'
import { ZoomButtons } from './ZoomButtons'
import { useMoonCamera } from './useMoonCamera'

interface Props {
  /** Sites to draw as dots. The selected site is always marked, even if it isn't in this list. */
  sites: SiteInfo[]
  selected: SiteInfo | undefined
  now: TrackPoint | null
  onSelect: (site: SiteInfo) => void
  onPick: (lat: number, lon: number) => void
  /** The browser took the graphics away: show the flat map instead. */
  onLost: () => void
}

/**
 * The whole Moon as a globe you can turn and zoom, lit by the Sun at the selected time. Click a dot
 * to choose a site, or anywhere else for a custom point. Idea and place names from Misha's NASA Globe
 * prototype; color from NASA's LROC mosaic.
 */
export function MoonGlobe({ sites, selected, now, onSelect, onPick, onLost }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { view, up, zoom, setZoom, flyTo, place: onDisk, handlers } = useMoonCamera({
    initialView: selected ? { lat: selected.lat, lon: selected.lon } : { lat: 0, lon: 0 },
    onPick,
    surfaceRef,
  })
  const [features, setFeatures] = useState<MoonFeatures | null>(null)
  const [showNames, setShowNames] = useState(true)
  const [sizePx, setSizePx] = useState(0)

  useEffect(() => {
    loadFeatures().then(setFeatures).catch(() => setFeatures(null))
  }, [])

  // Fly to a newly chosen site, easing out as in Misha's prototype.
  const goalLat = selected?.lat
  const goalLon = selected?.lon
  useEffect(() => {
    if (goalLat !== undefined && goalLon !== undefined) void flyTo({ lat: goalLat, lon: goalLon })
  }, [goalLat, goalLon, flyTo])

  const place = (lat: number, lon: number) => {
    const p = onDisk(lat, lon)
    const c = toCanvas(p, zoom)
    return p.facing > 0.05 && c.inside ? c : null
  }
  const listed = sites.some((site) => site.id === selected?.id)
  const selectedMark = selected && !listed ? place(selected.lat, selected.lon) : null

  return (
    <div className="globe-wrap">
      <div
        ref={surfaceRef}
        className="globe"
        role="application"
        aria-label="Moon globe. Drag or use the arrow keys to turn it, plus and minus to zoom."
        tabIndex={0}
        {...handlers}
      >
        <GlobeCanvas view={view} up={up} zoom={zoom} sun={now ? now.sun_vec_me : null} color onSize={setSizePx} onLost={onLost} />
        {features && showNames && <GlobeLabels features={features} place={onDisk} zoom={zoom} sizePx={sizePx} />}
        {selectedMark && (
          <span className="map-dot selected custom" style={diskStyle(selectedMark.x, selectedMark.y)}>
            <span>{selected?.name}</span>
          </span>
        )}
        {sites.map((site) => {
          const c = place(site.lat, site.lon)
          if (!c) return null
          const isSelected = site.id === selected?.id
          return (
            <button
              key={site.id}
              type="button"
              className={isSelected ? 'map-dot selected' : 'map-dot'}
              style={diskStyle(c.x, c.y)}
              aria-label={`Select ${site.name}`}
              aria-pressed={isSelected}
              title={site.name}
              onClick={() => onSelect(site)}
            >
              {isSelected && <span>{site.name}</span>}
            </button>
          )
        })}
        <ZoomButtons zoom={zoom} onZoom={setZoom} />
      </div>
      <label className="globe-names">
        <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
        Show place names
      </label>
    </div>
  )
}
