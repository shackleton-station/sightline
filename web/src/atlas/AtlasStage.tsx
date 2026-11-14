import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMoonCamera } from '../components/useMoonCamera'
import { ZoomButtons } from '../components/ZoomButtons'
import type { SiteInfo } from '../data/contract'
import { diskStyle, fitLabels } from '../lib/globe'
import { cellAt } from '../lib/lightGrid'
import { kmPerPixel, latLonOf, POLAR_UP_FROM_DEG, project, unitOf, type Vec3 } from '../lib/polarCamera'
import { scaleBar } from '../lib/scaleBar'
import type { LightView } from '../three/lightLayer'
import { AtlasCanvas } from './AtlasCanvas'
import type { LightGridState } from './useLightGrid'

/**
 * Where the camera should go: the whole Moon, the south pole, or the site on screen. A new `id`
 * starts a flight, even to the place it is already at; so does a new site while the goal is the site.
 */
export interface Goal {
  id: number
  to: 'moon' | 'pole' | 'site'
}

interface Props {
  sites: SiteInfo[]
  site: SiteInfo | null
  /** Unit vector toward the Sun in MOON_ME for the hour on screen, from the site's track. */
  sun: [number, number, number] | null
  hour: number
  layer: LightView
  light: LightGridState
  /** The ground the visitor tapped, if any. */
  picked: { lat: number; lon: number } | null
  goal: Goal
  onPick: (lat: number, lon: number) => void
  onChoose: (site: SiteInfo) => void
}

const MOON_RADIUS_KM = 1737.4
/** The whole Moon takes this share of the stage's shorter side. */
const WHOLE_MOON_SHARE = 0.9
/** Seen whole, the Moon is tilted so the south pole, where the sites are, is in view. */
const WHOLE_VIEW = { lat: -38, lon: -12 }
const SOUTH_POLE = { lat: -90, lon: 0 }
/** A flight between stops takes this long: slow enough to follow from the whole Moon down to a ridge. */
const FLIGHT_MS = 1600
/**
 * How close the view may go, and how close a flight to a site ends: inside the fine grid (its terrain
 * maps hold 30 m a pixel, and a site arrives with about 55 km across the picture), inside the wide
 * grid (300 m pixels), and elsewhere (the polar map holds about 300 m; the rest of the Moon far less).
 */
const CLOSEST = { fine: 128, wide: 40, none: 14 }
const SITE_ZOOM = { fine: 64, wide: 20, none: 8 }
/** The computed ground's square takes this share of the stage's shorter side in the south-pole view. */
const POLE_SHARE = 0.86
/** Narrower than this is the phone layout: the controls take the top of the stage and Scout the bottom. */
const NARROW_BELOW_PX = 700
/** On a phone, how far down the stage the middle of the view sits (0.5 is the middle): between the controls and Scout. */
const PHONE_CENTER = 0.4

/**
 * One picture from the whole Moon down to a ridge. The globe is drawn on a square big enough to
 * cover the stage and never swapped for another view: every stop is a zoom of the same camera.
 */
export function AtlasStage({ sites, site, sun, hour, layer, light, picked, goal, onPick, onChoose }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [sizePx, setSizePx] = useState(0)
  const [lost, setLost] = useState(false)
  const onLost = useCallback(() => setLost(true), [])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [])

  // On a phone the middle of the view moves up, clear of Scout's bubble; the square the globe is
  // drawn on grows by twice that shift, so it still reaches the bottom of the stage.
  const narrow = box.width > 0 && box.width < NARROW_BELOW_PX
  const middle = narrow ? PHONE_CENTER : 0.5
  const side = Math.max(box.width, box.height * (1 + 2 * (0.5 - middle)))
  const shorter = Math.min(box.width, box.height)
  const wholeZoom = side > 0 ? (shorter * WHOLE_MOON_SHARE) / side : 1
  const meta = light.meta ?? null
  const wideMeta = light.wideMeta
  /** Which grid, if any, holds the point in the middle of a view. */
  const gridAt = useCallback(
    (center: Vec3): 'fine' | 'wide' | 'none' => {
      const { lat, lon } = latLonOf(center)
      if (meta !== null && cellAt(meta, lat, lon) !== null) return 'fine'
      return wideMeta !== null && cellAt(wideMeta, lat, lon) !== null ? 'wide' : 'none'
    },
    [meta, wideMeta],
  )
  // The site's one camera (it has no seam at the poles); here the closest zoom depends on the ground.
  const { center, up, zoom, setZoom, flyTo, handlers } = useMoonCamera({
    initialView: WHOLE_VIEW,
    initialZoom: 0.5,
    surfaceRef,
    minZoom: wholeZoom,
    maxZoomAt: (at) => CLOSEST[gridAt(at)],
    onPick,
  })

  // A new goal: fly there. The zooms depend on the stage's size, so this waits until it is known.
  const ready = side > 0 && light.meta !== undefined
  // The south-pole stop shows all of the computed ground: the wide grid's square where there is one.
  const gridKm = ((wideMeta ?? meta)?.half_width_m ?? 60_000) / 500
  const poleZoom = side > 0 ? (2 * MOON_RADIUS_KM * POLE_SHARE * shorter) / (side * gridKm) : 16
  const flown = useRef('')
  const siteId = site?.id
  const siteLat = site?.lat
  const siteLon = site?.lon
  useEffect(() => {
    if (!ready || (goal.to === 'site' && siteLat === undefined)) return
    const flight = goal.to === 'site' ? `${goal.id} ${siteId}` : `${goal.id}`
    if (flown.current === flight) return
    flown.current = flight
    if (goal.to === 'moon') void flyTo(WHOLE_VIEW, wholeZoom, FLIGHT_MS)
    else if (goal.to === 'pole') void flyTo(SOUTH_POLE, poleZoom, FLIGHT_MS)
    else if (siteLat !== undefined && siteLon !== undefined) {
      // The square is wider than a phone's stage, so there the zoom is scaled to give the same
      // ground across the picture's width as on a wide screen (the neighbouring ridges stay in view).
      void flyTo({ lat: siteLat, lon: siteLon }, SITE_ZOOM[gridAt(unitOf(siteLat, siteLon))] * Math.min(1, box.width / side), FLIGHT_MS)
    }
  }, [ready, goal, siteId, siteLat, siteLon, flyTo, wholeZoom, poleZoom, gridAt, box.width, side])

  const marks = useMemo(() => {
    const placed = sites.flatMap((place) => {
      const at = project(unitOf(place.lat, place.lon), center, up)
      const x = at.x * zoom
      const y = at.y * zoom
      return at.facing > 0.05 && Math.abs(x) <= 1 && Math.abs(y) <= 1 ? [{ place, x, y }] : []
    })
    const shown = fitLabels(
      placed.map(({ place, x, y }) => ({ key: place.id, text: place.name, x, y: y - 0.05 })),
      sizePx,
    )
    return placed.map((mark) => ({ ...mark, label: shown.has(mark.place.id) }))
  }, [sites, center, up, zoom, sizePx])

  const pin = useMemo(() => {
    if (!picked) return null
    const at = project(unitOf(picked.lat, picked.lon), center, up)
    return at.facing > 0 ? { x: at.x * zoom, y: at.y * zoom } : null
  }, [picked, center, up, zoom])

  const bar = side > 0 ? scaleBar(kmPerPixel(zoom, side, MOON_RADIUS_KM)) : null
  const polar = Math.abs(latLonOf(center).lat) >= POLAR_UP_FROM_DEG
  const surface: CSSProperties = { width: side, height: side, top: `${middle * 100}%` }
  // The square is larger than the stage; only the part inside the stage is drawn.
  const visible = useMemo(() => {
    if (side === 0) return { left: 0, top: 0, right: 1, bottom: 1 }
    const left = (side - box.width) / 2 / side
    const top = Math.max(0, (side / 2 - middle * box.height) / side)
    return { left, top, right: 1 - left, bottom: Math.min(1, top + box.height / side) }
  }, [side, box.width, box.height, middle])

  return (
    <div ref={stage} className="atlas-moon">
      <div
        ref={surfaceRef}
        className="scout-globe atlas-globe"
        style={surface}
        role="application"
        aria-label="The Moon. Drag to move, scroll or pinch to zoom, arrow keys and plus and minus too. Tap the ground near the south pole for its Sun and Earth."
        tabIndex={0}
        {...handlers}
      >
        {lost ? (
          <p className="scout-lost">This browser can't draw the Moon. Choose a site from the list.</p>
        ) : (
          side > 0 &&
          light.meta !== undefined && (
            <AtlasCanvas center={center} up={up} zoom={zoom} sun={sun} hour={hour} layer={layer} meta={meta} month={light.month} wide={light.wide} visible={visible} onSize={setSizePx} onLost={onLost} />
          )
        )}
        {marks.map(({ place, x, y, label }) => (
          <button
            key={place.id}
            type="button"
            className={place.id === site?.id ? 'map-dot landing-dot selected' : 'map-dot landing-dot'}
            style={diskStyle(x, y)}
            aria-label={`Go to ${place.name}`}
            title={place.name}
            onClick={() => onChoose(place)}
          >
            <span className={label || place.id === site?.id ? undefined : 'off'}>{place.name}</span>
          </button>
        ))}
        {pin && <span className="atlas-pin" style={diskStyle(pin.x, pin.y)} aria-hidden="true" />}
      </div>

      <div className="atlas-corner">
        {bar && (
          <p className="atlas-scale" aria-label={`Scale: this bar is ${bar.km} kilometers of ground`}>
            <span style={{ width: bar.px }} />
            {bar.km >= 1 ? `${bar.km} km` : `${bar.km * 1000} m`}
          </p>
        )}
        {polar && (
          <p className="atlas-way-up">
            ↑ 0° longitude<span>, the side facing Earth</span>
          </p>
        )}
      </div>
      <ZoomButtons zoom={zoom} onZoom={setZoom} min={wholeZoom} max={CLOSEST[gridAt(center)]} />
    </div>
  )
}
