import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { customSiteInfo } from '../data/customSite'
import { diskStyle, fitLabels, siteAtCenter, toCanvas, wrapLon } from '../lib/globe'
import { subPoint } from '../lib/mapGeometry'
import { loopHours, sunAt } from '../lib/timelapse'
import { formatUtc } from '../lib/timeline'
import { GlobeCanvas } from './GlobeCanvas'
import { ZoomButtons } from './ZoomButtons'
import { useMoonCamera } from './useMoonCamera'
import { useTimelapse } from './useTimelapse'

interface Props {
  sites: SiteInfo[]
  /** An hourly track from the pipeline, used only for the Sun's direction in the time-lapse. */
  track: TrackPoint[] | null
  onEnter: (site: SiteInfo) => void
  onDemo: () => void
  onTour: () => void
  onHow: () => void
}

/** Zoom past this with a site near the middle, and the globe hands over to that site's detailed views. */
const ENTER_ZOOM = 3.5
/** Time-lapse speed: hours of the month per second, advanced a little every screen refresh. */
const HOURS_PER_SECOND = 25
/** A custom point exactly at a pole has no local north. */
const MAX_ABS_LAT = 89.5
const FEATURED = 'connecting-ridge'
/** Until someone takes over, the camera trails the Sun by this much, so the day-night line stays in view. */
const TRAIL_DEG = 40
const TILT_DEG = -32

/**
 * The front page: the whole Moon in NASA's natural color, lit by the Sun as our ephemeris has it,
 * hour by hour. Turn it, zoom into a site, and it hands over to the detailed views. Misha's globe
 * idea, with our data underneath.
 */
export function LandingPage({ sites, track, onEnter, onDemo, onTour, onHow }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const entering = useRef(false)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [sizePx, setSizePx] = useState(0)
  const [lost, setLost] = useState(false)
  const featured = sites.find((site) => site.id === FEATURED) ?? sites[0]

  const enter = useCallback(
    (site: SiteInfo, glide: (lat: number, lon: number) => Promise<void>) => {
      if (entering.current) return
      entering.current = true
      void glide(site.lat, site.lon).then(() => onEnter(site))
    },
    [onEnter],
  )

  const pick = (lat: number, lon: number) => {
    if (Math.abs(lat) > MAX_ABS_LAT) return
    enter(customSiteInfo(Number(lat.toFixed(4)), Number(lon.toFixed(4))), glide)
  }
  const { view, up, zoom, setZoom, flyTo, aim, place, handlers } = useMoonCamera({
    initialView: { lat: TILT_DEG, lon: 0 },
    onPick: pick,
    surfaceRef,
  })
  const glide = useCallback((lat: number, lon: number) => flyTo({ lat, lon }, 6, 1100), [flyTo])


  // Sunlight sweeps across the Moon: the light moves every frame, blended between hourly ephemeris
  // points, and the caption shows the whole hour it's in.
  // It loops over one solar day of the Moon, not the whole month, so it wraps without a jump.
  const loop = useMemo(() => (track ? loopHours(track) : 0), [track])
  const hour = useTimelapse(loop, playing, HOURS_PER_SECOND)
  const hasTrack = track !== null && track.length > 0
  const now = hasTrack ? track[Math.floor(hour) % track.length] : null
  const sun = useMemo(() => (hasTrack ? sunAt(track, hour, loop) : null), [hasTrack, track, hour, loop])

  // The camera follows the Sun, tilted south, so the lit side and the day-night line face the visitor
  // as the time-lapse runs. The first drag, zoom or key hands control to the visitor.
  const sunLon = sun ? subPoint(sun).lon : null
  useEffect(() => {
    if (sunLon !== null) aim({ lat: TILT_DEG, lon: wrapLon(sunLon + TRAIL_DEG) })
  }, [sunLon, aim])

  // Zooming in close to a site is the same as choosing it.
  useEffect(() => {
    if (zoom < ENTER_ZOOM) return
    const site = siteAtCenter(sites, view, 30 / zoom)
    if (site) enter(site, glide)
  }, [zoom, view, sites, enter, glide])

  const marks = useMemo(() => {
    const placed = sites.flatMap((site) => {
      const p = place(site.lat, site.lon)
      const c = toCanvas(p, zoom)
      return p.facing > 0.05 && c.inside ? [{ site, x: c.x, y: c.y }] : []
    })
    const shown = fitLabels(
      placed.map(({ site, x, y }) => ({ key: site.id, text: site.name, x, y: y - 0.05 })),
      sizePx,
    )
    return placed.map((mark) => ({ ...mark, label: shown.has(mark.site.id) }))
  }, [sites, place, zoom, sizePx])

  return (
    <section className="landing" aria-label="Lunar Landing Site Navigator">
      <div className="landing-copy">
        <p className="landing-kicker">NASA Space Apps 2026 · practice demo</p>
        <h1>Where on the Moon can we land, and when?</h1>
        <p className="landing-lede">
          Near the south pole, sunlight for power and Earth in view for radio come and go with the terrain.
          Spin the Moon, then zoom into a site to see both, hour by hour.
        </p>
        <div className="landing-actions">
          {featured && (
            <button type="button" className="primary" onClick={() => enter(featured, glide)}>
              Explore {featured.name} →
            </button>
          )}
          <button type="button" onClick={onDemo}>
            ▶ Watch the demo
          </button>
          <button type="button" onClick={onTour}>
            1-minute tour
          </button>
          <button type="button" onClick={onHow}>
            How it works
          </button>
        </div>
        <p className="landing-hint">Drag to spin · scroll, pinch or + to zoom into a site · click anywhere for a custom point</p>
      </div>

      <div
        ref={surfaceRef}
        className="landing-globe"
        role="application"
        aria-label="Moon globe. Drag or use the arrow keys to turn it, plus and minus to zoom in on a site."
        tabIndex={0}
        {...handlers}
      >
        {lost ? (
          <p className="landing-lost">This browser can't draw the globe. Choose a site with the button.</p>
        ) : (
          <GlobeCanvas view={view} up={up} zoom={zoom} sun={sun} color terrain onSize={setSizePx} onLost={() => setLost(true)} />
        )}
        {marks.map(({ site, x, y, label }) => (
          <button
            key={site.id}
            type="button"
            className="map-dot landing-dot"
            style={diskStyle(x, y)}
            aria-label={`Open ${site.name}`}
            title={site.name}
            onClick={() => enter(site, glide)}
          >
            {label && <span>{site.name}</span>}
          </button>
        ))}
        <ZoomButtons zoom={zoom} onZoom={setZoom} />
      </div>

      <div className="landing-foot">
        {now && (
          <p>
            Sunlight for {formatUtc(now.t)}, from NASA's SPICE ephemeris.{' '}
            <button type="button" className="link-button" onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'} the time-lapse
            </button>
          </p>
        )}
        <p className="landing-credit">
          Color: NASA's Scientific Visualization Studio (LROC mosaic, made for looks). Relief and every number:
          NASA LOLA terrain and SPICE, through our pipeline.
        </p>
      </div>
    </section>
  )
}
