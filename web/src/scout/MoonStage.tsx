import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { GlobeCanvas } from '../components/GlobeCanvas'
import { ZoomButtons } from '../components/ZoomButtons'
import { useMoonCamera } from '../components/useMoonCamera'
import { useTimelapse } from '../components/useTimelapse'
import { diskStyle, fitLabels, toCanvas, wrapLon } from '../lib/globe'
import { subPoint } from '../lib/mapGeometry'
import { loopHours, sunAt } from '../lib/timelapse'

interface Props {
  sites: SiteInfo[]
  /** An hourly track from the pipeline, used only for where the Sun is while no site is chosen. */
  track: TrackPoint[] | null
  /** The site being looked at: the Moon is zoomed in on it and lit for `now`. */
  site: SiteInfo | null
  /** The hour on the time river, at a site. */
  now: TrackPoint | null
  onChoose: (site: SiteInfo) => void
  /** The visitor zoomed back out far enough to see the whole Moon again. */
  onLeave: () => void
}

/** With no site chosen, this many hours of real ephemeris pass each second. */
const HOURS_PER_SECOND = 25
const TRAIL_DEG = 40
const TILT_DEG = -32
/** How far in the Moon is zoomed at a site, and how far out counts as leaving it. */
const SITE_ZOOM = 8
/** The polar map holds about 300 m a pixel: this is as close as it stays sharp. */
const CLOSEST_ZOOM = 14
const LEAVE_ZOOM = 1.6
const FLIGHT_MS = 1600
/** Narrower than this, the layout is the phone one: the stage on top with the bubble over its middle. */
const NARROW_BELOW_PX = 700
/** On a phone, how far down the stage the Moon's center sits at a site (0.5 is the middle). */
const PHONE_SITE_CENTER = 0.22
/** With no site chosen, the whole Moon takes this share of the stage's shorter side. */
const WHOLE_MOON_SHARE = 0.92

/**
 * The Moon, always. With no site chosen it is whole and turning, lit as the ephemeris has it.
 * Choosing a site zooms the same Moon in until it fills the stage, lit for the hour on the time
 * river; zooming back out returns to the whole Moon. Nothing is swapped: it is one globe throughout.
 */
export function MoonStage({ sites, track, site, now, onChoose, onLeave }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [sizePx, setSizePx] = useState(0)
  const [lost, setLost] = useState(false)
  const onLost = useCallback(() => setLost(true), [])
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  // The globe is drawn on a square big enough to cover the stage, and never resized or scaled:
  // the whole Moon and a close-up of a site are the same picture at two zooms of one camera.
  // On a phone Scout's bubble covers the middle of the stage, so at a site the Moon sits higher:
  // its center, where the site is, moves to the clear part above the bubble. The square is made
  // taller by twice that shift, so it still reaches the bottom of the stage.
  const narrow = box.width > 0 && box.width < NARROW_BELOW_PX
  const side = Math.max(box.width, narrow ? box.height * (1 + 2 * (0.5 - PHONE_SITE_CENTER)) : box.height)
  const wholeZoom = side > 0 ? (Math.min(box.width, box.height) * WHOLE_MOON_SHARE) / side : 1
  const { view, up, zoom, setZoom, flyTo, aim, place: placeOf, handlers } = useMoonCamera({
    initialView: { lat: TILT_DEG, lon: 0 },
    initialZoom: 0.5,
    surfaceRef,
    minZoom: wholeZoom,
    maxZoom: CLOSEST_ZOOM,
  })

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [])

  // With no site chosen, sunlight sweeps across the Moon, moving every frame between hourly
  // ephemeris points. At a site, it's lit for the hour on the time river.
  // It loops over one solar day of the Moon, not the whole month, so it wraps without a jump.
  const loop = useMemo(() => (track ? loopHours(track) : 0), [track])
  const hour = useTimelapse(loop, !still && !site, HOURS_PER_SECOND)
  const hasTrack = track !== null && track.length > 0
  const lapseSun = useMemo(() => (hasTrack ? sunAt(track, hour, loop) : null), [hasTrack, track, hour, loop])
  const sun = site ? (now?.sun_vec_me ?? null) : lapseSun

  // Until a site is chosen (or the visitor takes over), the camera keeps the day-night line in view.
  const sunLon = !site && lapseSun ? subPoint(lapseSun).lon : null
  useEffect(() => {
    if (sunLon !== null) aim({ lat: TILT_DEG, lon: wrapLon(sunLon + TRAIL_DEG) })
  }, [sunLon, aim])

  // Where the Moon is turned to and how big "whole" is right now, for the flight back out.
  const latest = useRef({ lon: view.lon, wholeZoom })
  useEffect(() => {
    latest.current = { lon: view.lon, wholeZoom }
  }, [view.lon, wholeZoom])

  // A site chosen: fly down to it. No site: fly back out to the whole Moon.
  const arrived = useRef(false)
  const siteLat = site?.lat
  const siteLon = site?.lon
  const ready = side > 0
  useEffect(() => {
    if (!ready) return
    arrived.current = false
    if (siteLat === undefined || siteLon === undefined) {
      // Stay turned the way the Moon is now; only pull back and level out.
      void flyTo({ lat: TILT_DEG, lon: latest.current.lon }, latest.current.wholeZoom, FLIGHT_MS)
      return
    }
    let current = true
    void flyTo({ lat: siteLat, lon: siteLon }, SITE_ZOOM, FLIGHT_MS).then(() => {
      if (current) arrived.current = true
    })
    return () => {
      current = false
    }
  }, [siteLat, siteLon, flyTo, ready])

  // Zooming back out far enough is the same as choosing "All sites".
  useEffect(() => {
    if (site && arrived.current && zoom < LEAVE_ZOOM) onLeave()
  }, [site, zoom, onLeave])

  const marks = useMemo(() => {
    const placed = sites.flatMap((place) => {
      const p = placeOf(place.lat, place.lon)
      const c = toCanvas(p, zoom)
      return p.facing > 0.05 && c.inside ? [{ place, x: c.x, y: c.y }] : []
    })
    const shown = fitLabels(
      placed.map(({ place, x, y }) => ({ key: place.id, text: place.name, x, y: y - 0.05 })),
      sizePx,
    )
    return placed.map((mark) => ({ ...mark, label: shown.has(mark.place.id) }))
  }, [sites, placeOf, zoom, sizePx])

  const surface: CSSProperties = { width: side, height: side, top: `${(narrow && site ? PHONE_SITE_CENTER : 0.5) * 100}%` }

  return (
    <div ref={stage} className="scout-moon">
      <div
        ref={surfaceRef}
        className="scout-globe"
        style={surface}
        role="application"
        aria-label="The Moon. Drag or use the arrow keys to turn it, plus and minus to zoom, and choose a site."
        tabIndex={0}
        {...handlers}
      >
        {lost ? (
          <p className="scout-lost">This browser can't draw the Moon. Choose a site from the list.</p>
        ) : (
          side > 0 && <GlobeCanvas view={view} up={up} zoom={zoom} sun={sun} color terrain onSize={setSizePx} onLost={onLost} />
        )}
        {marks.map(({ place, x, y, label }) => (
          <button
            key={place.id}
            type="button"
            className={place.id === site?.id ? 'map-dot landing-dot selected' : 'map-dot landing-dot'}
            style={diskStyle(x, y)}
            aria-label={`Land at ${place.name}`}
            title={place.name}
            onClick={() => onChoose(place)}
          >
            {/* Always there, and faded in or out, so a name never pops as the Moon turns. */}
            <span className={label || place.id === site?.id ? undefined : 'off'}>{place.name}</span>
          </button>
        ))}
      </div>
      <ZoomButtons zoom={zoom} onZoom={setZoom} min={wholeZoom} max={CLOSEST_ZOOM} />
    </div>
  )
}
