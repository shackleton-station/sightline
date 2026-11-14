import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { GlobeCanvas } from '../components/GlobeCanvas'
import type { GlobeOverlay, GlobeOverlayDetail, GroundDetail } from '../three/GlobeViewer'
import { loadTrekWindow } from '../data/trekPicture'
import { detailClosestMPerPx, detailWindow, detailWindowKey, regionalAt, UNTIED_FROM_M_PER_PX, UNTIED_GAP_M } from '../lib/moonDetail'
import { type FinePhoto, inFinePhoto, TREK_RADIUS_M, type TrekLayer, trekClosestMPerPx, trekGround, trekHalfWidthM, trekLayer, trekWindow, trekWindowKey } from '../lib/trekLayers'
import { ZoomButtons } from '../components/ZoomButtons'
import { useMoonCamera } from '../components/useMoonCamera'
import { MOON_RADIUS_M } from '../lib/customModel'
import { WHOLE_MOON_SHARE } from '../lib/moonRoom'
import { toCanvas } from '../lib/globe'
import type { RiverState } from '../lib/river'
import type { Vec3 } from '../lib/sightline'
import { DOT_REACH_PX, GROUP_REACH_PX, groupOverlapping, type LabelSide, middleOf, placeLabels, zoomForScale } from '../lib/sightlineDots'
import type { LightMeta, LightMonth } from '../lib/lightGrid'
import { kmPerPixel, project } from '../lib/polarCamera'
import { scaleBar, scaleWords } from '../lib/scaleBar'
import { needleDeg, refitZoom, viewMoved } from '../lib/sightlineView'
import { poseAt } from '../lib/trackball'
import { Dots, type Marker } from './Dots'
import { Sky } from './Sky'

interface Props {
  sites: SiteInfo[]
  /** What is up at each site at the hour on the clock, by site id. Missing until the flags load. */
  states: Map<string, RiverState>
  /** Unit vector toward the Sun in MOON_ME for the moment on the clock; null lights the Moon evenly. */
  sun: Vec3 | null
  /** Unit vector toward Earth in MOON_ME for the moment on the clock, for the Earth drawn beside the Moon; null until it is known. */
  earth: Vec3 | null
  /** Everything but the Moon is hidden: no dots, no zoom buttons. */
  bare: boolean
  /** Pixels at the bottom of the stage to keep clear of the Moon (Watch's play control sits there). */
  reserveBottom: number
  /** The site of the scenario on show, outlined; null in Watch. */
  selectedId: string | null
  /** The place to fly down to and stay close on (the rail's "Site"); null shows the whole Moon. */
  focus: { lat: number; lon: number } | null
  onChoose: (site: SiteInfo) => void
  /** A click on the Moon away from any dot: a custom point. Left out where a click does nothing. */
  onPick?: (lat: number, lon: number) => void
  /** The site under the pointer or with focus, for Scout to talk about; null when it leaves. */
  onPoint: (site: SiteInfo | null) => void
  /** The visitor asked for the default view again (the compass): leave any close-up. */
  onRecentre: () => void
  /** A Moon Trek layer laid over the ground around the south pole, or none. */
  overlay?: GlobeOverlay | null
  /** The layer that picture is of: close up, the ground in view is fetched from Moon Trek at the detail the zoom needs. */
  layer?: TrekLayer | null
  /** Where the photo layer has our own finer tiles (a disc round each ridge site), once the photo is on; else null. */
  fine?: FinePhoto | null
  /**
   * The pipeline's light grid, for the close-up of a polar site: its description (undefined until it
   * is known whether this build has one), the month's data as it arrives, the hour of that month on
   * the clock (null leaves the grid off), and what the grid says of the site itself at that hour.
   */
  grid: { meta: LightMeta | null | undefined; month: LightMonth | null; wide: LightMonth | null; hour: number | null; atSite: { sun: boolean; earth: boolean } | null }
}

/**
 * A still of the Moon as this page first draws it (the view from over the south pole at the first
 * hour of the data), made from the page itself by `scripts/sightline-shots.mjs --poster`. It is
 * about 50 kB, so it is on screen while the globe's code and maps are still on their way.
 */
const POSTER_URL = `${import.meta.env.BASE_URL}data/maps/moon_poster.jpg`
/** The view starts over the south pole, where the sites worth landing at are. */
const OVER_THE_POLE = { lat: -90, lon: 0 }
const DEFAULT_POSE = poseAt(OVER_THE_POLE.lat, OVER_THE_POLE.lon)
/** Zoomed all the way out, the Moon's disc is this share of the stage's shorter side: room to see Earth and the sky around it. */
const FAR_MOON_SHARE = 1 / 3
/** The polar map holds about 300 m a pixel: closer than this many metres a pixel it goes soft. */
const CLOSEST_M_PER_PX = 250
/**
 * How close the Moon is drawn at a site, in metres a pixel: close enough that the two ridge sites
 * nearest each other (10 km apart) are separate dots, on a phone as on a laptop.
 */
const SITE_M_PER_PX = 420
const FLIGHT_MS = 1400

/**
 * The Moon, and only the Moon: one globe seen from over the south pole, lit as the ephemeris has it
 * for the moment on the clock, with a dot for each site coloured by what is up there right then
 * (sites too close to tell apart at the zoom on show share one group marker). Nothing else is drawn on it.
 *
 * The view belongs to the visitor: once they turn or zoom the Moon it stays exactly there, through
 * time playing and the stage changing size. It moves by itself only when they pick a site that is
 * out of view, change between the whole Moon and a site, or press the compass to recentre.
 */
/**
 * The Moon's own picture round the south pole, for a close view with no layer on: the Photo layer's
 * mosaic without Moon Trek's other close-up product, which sits 300 m away (lib/trekLayers.ts).
 */
const POLAR_GROUND: TrekLayer | null = (() => {
  const photo = trekLayer('photo')
  return photo ? { ...photo, closeUp: undefined } : null
})()

/** A view's middle as east longitude and latitude, in degrees, from its direction in MOON_ME. */
function lonLatOf(direction: readonly [number, number, number]): { lon: number; lat: number } {
  return { lon: (Math.atan2(direction[1], direction[0]) * 180) / Math.PI, lat: (Math.asin(Math.max(-1, Math.min(1, direction[2]))) * 180) / Math.PI }
}

/** How close to a zoom limit counts as being at it, as a share of the limit. */
const ZOOM_SLACK = 1e-6

export function Stage({ sites, states, sun, earth, bare, reserveBottom, selectedId, focus, onChoose, onPoint, onPick, onRecentre, overlay = null, layer = null, fine = null, grid }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [lost, setLost] = useState(false)
  // Until the globe has drawn its first frame a still of the Moon stands in for it: the same view, in a file small enough to arrive with the page.
  const [drawn, setDrawn] = useState(false)
  const onDrawn = useCallback(() => setDrawn(true), [])
  const onLost = useCallback(() => setLost(true), [])

  // The globe is drawn on a square big enough to cover the stage and never resized or scaled, so the
  // whole Moon and a close-up are the same picture at two zooms of one camera.
  // The Moon is centred in the room above anything kept clear at the bottom, so the square is drawn
  // that much taller to still reach the stage's bottom edge.
  const freeHeight = Math.max(box.height - reserveBottom, 0)
  // Nothing has a size until the stage is measured: a square made of the margin alone would hand the camera a zoom of zero.
  const side = box.width > 0 && freeHeight > 0 ? Math.max(box.width, box.height + reserveBottom) : 0
  const wholeZoom = side > 0 ? (Math.min(box.width, freeHeight) * WHOLE_MOON_SHARE) / side : 1
  const farZoom = side > 0 ? (Math.min(box.width, freeHeight) * FAR_MOON_SHARE) / side : 1
  const siteZoom = Math.max(zoomForScale(SITE_M_PER_PX, side, MOON_RADIUS_M), wholeZoom)
  const closestZoom = Math.max(zoomForScale(CLOSEST_M_PER_PX, side, MOON_RADIUS_M), siteZoom)
  // A Moon Trek layer has finer ground than the app's own maps: with one on, and the view over the
  // ground it covers, the camera may go in until the layer's finest pixels are a little enlarged.
  const layerZoom = layer && overlay ? zoomForScale(trekClosestMPerPx(layer), side, MOON_RADIUS_M) : 0
  const layerCapCos = layer ? Math.cos((0.9 * trekHalfWidthM(layer)) / TREK_RADIUS_M) : 2
  // Over a disc of our own finer photo the camera may go in as far as those tiles' pixels allow.
  const fineZoom = layer && overlay && fine && layer.id === 'photo' ? zoomForScale(trekClosestMPerPx(layer, fine.level), side, MOON_RADIUS_M) : 0
  // Close on a site with no layer on, the Moon's own picture gets sharper from Moon Trek's photos of
  // the ground, so the camera may go in as far as the finest of them has pixels for that place.
  const groundClosest = (middle: readonly [number, number, number]) => {
    if (!focus || layer || side <= 0) return closestZoom
    const ground = trekGround(middle)
    let metresPerPx: number
    if (POLAR_GROUND && middle[2] < -0.9 && Math.max(Math.abs(ground.x), Math.abs(ground.y)) <= 0.9 * trekHalfWidthM(POLAR_GROUND)) {
      metresPerPx = fine && inFinePhoto(fine, ground.x, ground.y) ? trekClosestMPerPx(POLAR_GROUND, fine.level) : trekClosestMPerPx(POLAR_GROUND)
    } else {
      const at = lonLatOf(middle)
      metresPerPx = Math.abs(at.lat) > 87 ? CLOSEST_M_PER_PX : detailClosestMPerPx(at.lon, at.lat)
    }
    return Math.max(closestZoom, zoomForScale(metresPerPx, side, MOON_RADIUS_M))
  }
  const closestAt = (middle: readonly [number, number, number]) => {
    if (!layer) return groundClosest(middle)
    if (!(layerZoom > closestZoom && -middle[2] >= layerCapCos)) return closestZoom
    if (fine && fineZoom > layerZoom) {
      const ground = trekGround(middle)
      if (inFinePhoto(fine, ground.x, ground.y)) return fineZoom
    }
    return layerZoom
  }
  const { view, center, up, zoom, setZoom, zoomTo, flyTo, place: placeOf, handlers } = useMoonCamera({
    initialView: OVER_THE_POLE,
    initialZoom: 0.5,
    surfaceRef,
    minZoom: farZoom,
    maxZoom: closestZoom,
    // Over a Moon Trek layer the view may go as close as the layer's own finest pixels.
    maxZoomAt: (middle) => closestAt(middle),
    onPick,
    // The picture stays as the visitor turned it; it is not eased back the usual way up.
    keepTurn: true,
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

  // The camera has two resting places: the whole Moon from over the pole, and close on a site.
  const [placed, setPlaced] = useState(false)
  const focusLat = focus?.lat
  const focusLon = focus?.lon

  // The stage changed size (the first measure, a strip folding, a drawer opening, the window). The
  // visitor's direction is kept, and so is their zoom: a view still at the whole-Moon fit takes the
  // new fit, so the disc is never cut off, and a zoomed view keeps the ground the same size on
  // screen. Nothing flies anywhere, and nothing waits on an animation. (An effect, not a layout
  // effect: the camera learns its new zoom limits in an effect of its own, which must run first.)
  const [fit, setFit] = useState({ side: 0, wholeZoom: 1 })
  useEffect(() => {
    if (side === 0) return
    setZoom(refitZoom(zoom, fit, { side, wholeZoom, farZoom }))
    setFit({ side, wholeZoom })
    setPlaced(true)
    // Only a change of size starts this, with the zoom as it is at that moment.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [side, wholeZoom])

  // The visitor chose the whole Moon or a site (the rail's Orbit and Site): fly there.
  useEffect(() => {
    if (!placed) return
    if (focusLat === undefined || focusLon === undefined) void flyTo(OVER_THE_POLE, wholeZoom, 600)
    else void flyTo({ lat: focusLat, lon: focusLon }, siteZoom, FLIGHT_MS)
    // The sizes are read as they are when the choice is made; a change of size is the effect above.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLat, focusLon, flyTo])

  // The visitor picked a site (a dot, the group's list, the site field). If it is out of view, on
  // the far side or off the edge of the stage, turn the Moon to bring it to the middle; if it can
  // already be seen, leave the view alone.
  const selected = selectedId ? sites.find((site) => site.id === selectedId) : undefined
  useEffect(() => {
    if (!placed || !selected || focusLat !== undefined) return
    const p = placeOf(selected.lat, selected.lon)
    const c = toCanvas(p, zoom)
    // The globe's square is centred on the stage's free room; the stage shows only part of it.
    const x = (c.x * side) / 2
    const y = (-c.y * side) / 2
    const inView = p.facing > 0.05 && Math.abs(x) <= box.width / 2 - 12 && Math.abs(y) <= freeHeight / 2 - 12
    if (!inView) void flyTo({ lat: selected.lat, lon: selected.lon }, zoom, 900)
    // Only a new choice of site starts this, with the view as it is at that moment.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, placed])

  // Whether the view has been moved from the default one, and which way: for the recentre compass.
  const moved = placed && viewMoved({ center, up, zoom }, { ...DEFAULT_POSE, zoom: fit.wholeZoom })
  const needle = needleDeg({ center, up }, DEFAULT_POSE.up)

  const markers = useMemo((): Marker[] => {
    const placedSites = sites.flatMap((site) => {
      const p = placeOf(site.lat, site.lon)
      const c = toCanvas(p, zoom)
      return p.facing > 0.05 && c.inside ? [{ site, x: ((c.x + 1) / 2) * side, y: ((1 - c.y) / 2) * side }] : []
    })
    // Sites that would print over one another at this zoom become one group marker.
    const grouped = groupOverlapping(placedSites).map((members) => {
      const selected = members.find((member) => member.site.id === selectedId)
      const alone = members.length === 1
      const text = alone ? members[0].site.name : selected ? `${selected.site.name} + ${members.length - 1} more` : `${members.length} sites`
      const middle = alone ? members[0] : middleOf(members)
      return { key: members.map((member) => member.site.id).join('+'), sites: members.map((member) => member.site), x: middle.x, y: middle.y, text, selected: selected !== undefined, reach: alone ? DOT_REACH_PX : GROUP_REACH_PX }
    })
    // Names are given room in this order: the scenario's site, then groups, then the rest.
    const rank = (marker: (typeof grouped)[number]) => (marker.selected ? 0 : marker.sites.length > 1 ? 1 : 2)
    // The scenario's own site, when it is a dot of its own, always shows its name: on whichever side
    // keeps it off the other dots, so it is never read as a neighbour's. Every other name goes under
    // its marker, where there is room, as before.
    const below: LabelSide[] = ['below']
    const shown = placeLabels(
      [...grouped].sort((a, b) => rank(a) - rank(b)).map((marker) => {
        const own = marker.selected && marker.sites.length === 1
        return { ...marker, must: own, sides: own ? undefined : below }
      }),
      side,
    )
    return grouped.map((marker) => ({ ...marker, label: shown.has(marker.key), labelSide: shown.get(marker.key) ?? 'below' }))
  }, [sites, placeOf, zoom, side, selectedId])

  // The "Light and shadow" layer: ground the Sun cannot reach at the hour on the clock is darkened,
  // from the light grid (the same data the Atlas draws). Nothing is recolored and no cell shows.
  const gridShow = useMemo(() => (grid.hour !== null ? { hour: grid.hour, view: 'shade' as const } : null), [grid.hour])
  // Close on a site: a scale bar and the way to Earth.
  const bar = focus && side > 0 ? scaleBar(kmPerPixel(zoom, side, MOON_RADIUS_M / 1000)) : null
  // Which way Earth lies across the ground on screen, clockwise from up; none when Earth is nearly overhead.
  const toEarth = focus && earth ? project(earth, center, up) : null
  const earthDeg = toEarth && Math.hypot(toEarth.x, toEarth.y) > 0.05 ? (Math.atan2(toEarth.x, toEarth.y) * 180) / Math.PI : null

  // Close up under a Moon Trek layer: the ground in view, at the level whose pixels match the screen's.
  // It is asked for once the view has rested a moment, and the last picture stays until the new one is in.
  const metresPerPx = side > 0 ? (2 * MOON_RADIUS_M) / (zoom * side) : 0
  const [c0, c1, c2] = center
  const wanted = useMemo(
    () => (layer && overlay && metresPerPx > 0 && c2 < -0.9 ? trekWindow(layer, trekGround([c0, c1, c2]), ((metresPerPx * Math.hypot(box.width, box.height)) / 2) * 1.1, metresPerPx, fine) : null),
    [layer, overlay, fine, metresPerPx, c0, c1, c2, box.width, box.height],
  )
  const wantedKey = wanted ? trekWindowKey(wanted) : null
  // The same with no layer on, close on a site: the ground in view from Moon Trek's own photos of
  // it, for the Moon's picture to get sharper from. Round the south pole the polar mosaic (and our
  // 1 m tiles round the ridge sites); elsewhere the whole-Moon and regional pictures.
  const groundWanted = useMemo(() => {
    if (!focus || layer || metresPerPx <= 0) return null
    const reach = ((metresPerPx * Math.hypot(box.width, box.height)) / 2) * 1.1
    const polar = POLAR_GROUND && c2 < -0.9 ? trekWindow(POLAR_GROUND, trekGround([c0, c1, c2]), reach, metresPerPx, fine) : null
    if (polar) {
      const place = { kind: 'polar' as const, centreXM: polar.centreXM, centreYM: polar.centreYM, halfWidthM: polar.halfWidthM, halfHeightM: polar.halfHeightM, radiusM: TREK_RADIUS_M }
      return { key: `polar/${trekWindowKey(polar)}`, tiles: polar, place, level: polar.level, product: polar.product, metresPerPixel: polar.metresPerPixel }
    }
    const at = lonLatOf([c0, c1, c2])
    const found = detailWindow(at.lon, at.lat, reach, metresPerPx)
    if (!found) return null
    const place = { kind: 'lonLat' as const, lonDeg: found.lonDeg, latDeg: found.latDeg, halfLonDeg: found.halfLonDeg, halfLatDeg: found.halfLatDeg }
    return { key: `lonLat/${detailWindowKey(found)}`, tiles: found, place, level: found.level, product: found.product, metresPerPixel: found.metresPerPixel }
  }, [focus, layer, fine, metresPerPx, c0, c1, c2, box.width, box.height])
  const groundKey = groundWanted?.key ?? null
  // Close on a site whose picture is not tied to its coordinates, its marker is a ring of that much ground.
  const within = useMemo(() => {
    if (!focus || layer || metresPerPx <= 0 || metresPerPx >= UNTIED_FROM_M_PER_PX) return null
    const ids = new Set(sites.filter((site) => regionalAt(site.lon, site.lat) !== null).map((site) => site.id))
    return ids.size > 0 ? { ids, radiusPx: UNTIED_GAP_M / metresPerPx } : null
  }, [focus, layer, metresPerPx, sites])
  const [ground, setGround] = useState<{ key: string; level: number; product: string; picture: GroundDetail } | null>(null)
  useEffect(() => {
    if (!groundWanted || !groundKey) return
    let current = true
    const timer = window.setTimeout(() => {
      void loadTrekWindow(groundWanted.tiles).then((image) => {
        if (!current || !image) return
        setGround({ key: groundKey, level: groundWanted.level, product: groundWanted.product, picture: { image, place: groundWanted.place, metresPerPixel: groundWanted.metresPerPixel } })
      })
    }, 180)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // The key names the tiles: the same key is the same picture, however the view moved inside it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey])
  // On show while one is wanted: the last picture stays until the next is in, and outside it the base map is simply itself.
  const shownGround = groundWanted && ground ? ground : null
  const [detail, setDetail] = useState<{ key: string; layerId: string; level: number; picture: GlobeOverlayDetail } | null>(null)
  useEffect(() => {
    if (!wanted || !wantedKey || !layer) return
    let current = true
    const timer = window.setTimeout(() => {
      void loadTrekWindow(wanted).then((image) => {
        if (!current || !image) return
        setDetail({
          key: wantedKey,
          layerId: layer.id,
          level: wanted.level,
          picture: { image, centreXM: wanted.centreXM, centreYM: wanted.centreYM, halfWidthM: wanted.halfWidthM, halfHeightM: wanted.halfHeightM, radiusM: TREK_RADIUS_M },
        })
      })
    }, 180)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // The key names the tiles: the same key is the same picture, however the view moved inside it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, layer])
  // Shown only while a close-up is wanted for the layer it was fetched for, and only while it still
  // covers the ground in view: zooming out or turning past its edge goes back to the layer's whole
  // picture (softer, but complete) until the new close-up is in, so there is never a hole.
  const viewReachM = (metresPerPx * Math.hypot(box.width, box.height)) / 2
  const viewMiddle = trekGround([c0, c1, c2])
  const covers = (picture: GlobeOverlayDetail) =>
    Math.abs(viewMiddle.x - picture.centreXM) + viewReachM <= picture.halfWidthM && Math.abs(viewMiddle.y - picture.centreYM) + viewReachM <= picture.halfHeightM
  const shownDetail = wanted && layer && detail && detail.layerId === layer.id && covers(detail.picture) ? detail : null

  // Where the view's buttons are on the stage, so Earth keeps off them. Measured whenever they could have changed.
  const tools = useRef<HTMLDivElement>(null)
  const [keepClear, setKeepClear] = useState<{ left: number; top: number; right: number; bottom: number }[]>([])
  useEffect(() => {
    const stageBox = stage.current?.getBoundingClientRect()
    const toolsBox = tools.current?.getBoundingClientRect()
    const next = stageBox && toolsBox && toolsBox.width > 0 ? [{ left: toolsBox.left - stageBox.left, top: toolsBox.top - stageBox.top, right: toolsBox.right - stageBox.left, bottom: toolsBox.bottom - stageBox.top }] : []
    setKeepClear((last) => (JSON.stringify(last) === JSON.stringify(next) ? last : next))
  }, [box.width, box.height, bare, moved, focus])

  const surface: CSSProperties = { width: side, height: side, top: freeHeight / 2 }

  return (
    <div ref={stage} className="sl-moon" data-grid={gridShow ? 'on' : 'off'} data-grid-sun={grid.atSite ? String(grid.atSite.sun) : ''} data-grid-earth={grid.atSite ? String(grid.atSite.earth) : ''} data-layer-level={shownDetail ? shownDetail.level : ''} data-ground-level={shownGround ? shownGround.level : ''} data-ground-product={shownGround ? shownGround.product : ''}>
      {/* Under the Moon: stars and Earth can never cover its disc. */}
      {placed && <Sky pose={{ center, up }} box={box} disc={{ x: box.width / 2, y: freeHeight / 2, r: (zoom * side) / 2 }} earth={earth} sun={sun} keepClear={keepClear} />}
      <div
        ref={surfaceRef}
        className="scout-globe"
        style={surface}
        data-disc-px={Math.round(zoom * side)}
        data-pose={[...center, ...up].map((value) => (Math.round(value * 1e4) / 1e4 + 0).toFixed(4)).join(',')}
        role="application"
        aria-label="The Moon, seen from over its south pole. Drag or use the arrow keys to turn it, plus and minus to zoom, and choose a site."
        tabIndex={0}
        {...handlers}
      >
        {!drawn && !lost && side > 0 && (
          <img className="sl-poster" src={POSTER_URL} alt="" width={Math.round(wholeZoom * side)} height={Math.round(wholeZoom * side)} decoding="async" />
        )}
        {lost ? (
          <p className="scout-lost">This browser can't draw the Moon.</p>
        ) : (
          // Built once it is known whether there is a light grid: the grid decides how the globe is built.
          side > 0 && placed && grid.meta !== undefined && (
            <GlobeCanvas view={view} up={up} zoom={zoom} sun={sun} earth={earth} color terrain overlay={overlay} overlayDetail={shownDetail?.picture ?? null} ground={shownGround?.picture ?? null} lightMeta={grid.meta} lightMonth={grid.month} lightWide={grid.wide} lightShow={gridShow} onLost={onLost} onDrawn={onDrawn} />
          )
        )}
        {!bare && placed && <Dots markers={markers} side={side} states={states} onChoose={onChoose} onPoint={onPoint} within={within} />}
      </div>
      {!bare && (
        <div ref={tools} className="sl-view-tools">
          {/* Only while the view is away from the default: nothing extra on screen until it is needed. */}
          {moved && (
            <button
              type="button"
              className="sl-recentre"
              aria-label="Recentre the Moon"
              title="Recentre the Moon: back to the view from over the south pole"
              onClick={() => {
                void flyTo(OVER_THE_POLE, wholeZoom, 400)
                onRecentre()
              }}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
                {/* The needle points the way the default view's "up" now lies on the screen. */}
                <g transform={`rotate(${needle.toFixed(1)} 12 12)`}>
                  <path d="M12 3.5 L15 12 L12 10.6 L9 12 Z" fill="#e9b44c" />
                  <path d="M12 20.5 L9 12 L12 13.4 L15 12 Z" fill="currentColor" opacity="0.45" />
                </g>
              </svg>
            </button>
          )}
          {/* The camera stops a rounding error short of its limit at some stage sizes: "at the limit" allows for it. */}
          <ZoomButtons zoom={zoom} onZoom={zoomTo} min={farZoom * (1 + ZOOM_SLACK)} max={closestAt(center) * (1 - ZOOM_SLACK)} />
          {earthDeg !== null && (
            <p className="sl-to-earth" role="img" aria-label="The way to Earth across the ground, at the moment on the time bar" title="The way to Earth across the ground, at the moment on the time bar">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <g transform={`rotate(${earthDeg.toFixed(1)} 12 12)`}>
                  <path d="M12 2.5 L17 11 L13.2 11 L13.2 21 L10.8 21 L10.8 11 L7 11 Z" fill="#5aa9ff" />
                </g>
              </svg>
              <span>Earth</span>
            </p>
          )}
        </div>
      )}
      {/* The scale bar where a map's is looked for: the stage's bottom right corner. */}
      {!bare && bar && (
        <p className="sl-scale" aria-label={`Scale: this bar is ${scaleWords(bar.km)} of ground`}>
          <span style={{ width: bar.px }} />
          {scaleWords(bar.km)}
        </p>
      )}
    </div>
  )
}
