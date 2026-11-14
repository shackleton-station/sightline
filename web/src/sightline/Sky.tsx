import { useEffect, useMemo, useRef, useState } from 'react'
import type { Vec3 } from '../lib/sightline'
import { type Disc, earthLitShare, earthPlace, earthShade, type KeepClear, makeStars, type SkyPose, starsInView, toScreenFrame } from '../lib/sky'

interface Props {
  pose: SkyPose
  /** The stage's size, and the Moon's disc on it, in CSS pixels. */
  box: { width: number; height: number }
  disc: Disc
  /** Unit vectors from the Moon toward Earth and the Sun for the moment on show; null until the ephemeris loads. */
  earth: Vec3 | null
  sun: Vec3 | null
  /** Controls drawn over the stage, which Earth keeps off. */
  keepClear?: KeepClear[]
}

/** The Earth picture the app already ships for its 3D view (NASA Blue Marble): a flat map, -180° at the left. */
const EARTH_MAP_URL = `${import.meta.env.BASE_URL}data/maps/earth_color.jpg`
/** The face of Earth shown, since its spin is not modelled: the meridian in the middle of the disc. */
const EARTH_FACE_LON_DEG = 15
const STARS = makeStars()

/**
 * Earth's radius on screen: a tenth of the Moon's, between 16 and 30 pixels. Big enough to read as a
 * globe and not as a fault in the picture; still not to scale (Earth is 3.7 Moons across), which
 * its tooltip says. Where the stage is tight, `earthPlace` moves it round the Moon to where it fits.
 */
function earthRadiusPx(disc: Disc): number {
  return Math.max(16, Math.min(30, disc.r * 0.1))
}

/** How much of its daylight Earth's night side keeps, so the disc is never a hole in the sky. */
const EARTH_NIGHT = 0.07
/** The thin blue rim of air round the whole disc: its share on the night side, where it is all that marks the edge. */
const EARTH_RIM_NIGHT = 0.3

/** The flat Earth map's pixels, read once; null if it can't be loaded. */
function useEarthMap(): ImageData | null {
  const [map, setMap] = useState<ImageData | null>(null)
  useEffect(() => {
    let current = true
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      // Earth is drawn a few dozen pixels wide: a small copy of the map is plenty.
      canvas.width = 512
      canvas.height = 256
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context || !current) return
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      setMap(context.getImageData(0, 0, canvas.width, canvas.height))
    }
    image.src = EARTH_MAP_URL
    return () => {
      current = false
    }
  }, [])
  return map
}

/**
 * What lies around the Moon: made-up stars, fixed to the Moon's frame so they turn with the view,
 * and Earth in its true direction with its true phase, drawn right beside the Moon (not to scale).
 * Both are drawn underneath the Moon, so neither can ever cover its disc.
 */
export function Sky({ pose, box, disc, earth, sun, keepClear }: Props) {
  const starsRef = useRef<HTMLCanvasElement>(null)
  const earthRef = useRef<HTMLCanvasElement>(null)
  const map = useEarthMap()
  const [cx, cy, cz] = pose.center
  const [ux, uy, uz] = pose.up

  const stars = useMemo(
    () => (box.width > 0 ? starsInView(STARS, { center: [cx, cy, cz], up: [ux, uy, uz] }, box, disc) : []),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [cx, cy, cz, ux, uy, uz, box.width, box.height, disc.x, disc.y, disc.r],
  )
  useEffect(() => {
    const canvas = starsRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(box.width * scale)
    canvas.height = Math.round(box.height * scale)
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.clearRect(0, 0, box.width, box.height)
    for (const star of stars) {
      // A touch of blue or of warmth, as stars have; never a saturated colour.
      const warm = star.tint > 0
      context.fillStyle = `rgba(${warm ? 255 : 228}, ${warm ? 240 : 236}, ${warm ? 226 : 255}, ${star.alpha})`
      context.beginPath()
      context.arc(star.x, star.y, star.size, 0, 2 * Math.PI)
      context.fill()
    }
  }, [stars, box.width, box.height])

  const radius = earthRadiusPx(disc)
  // Which way round the Moon's edge Earth last went to find room, so it stays there and does not hop sides.
  const [side, setSide] = useState<-1 | 0 | 1>(0)
  const place = earth && box.width > 0 ? earthPlace(earth, { center: [cx, cy, cz], up: [ux, uy, uz] }, disc, radius, box, keepClear, side) : null
  const placedSide = place?.side ?? 0
  useEffect(() => {
    // Only a side it really went to is remembered: where it has room, or none at all, the last one stands.
    if (placedSide !== 0) setSide(placedSide)
  }, [placedSide])
  const light = sun ? toScreenFrame(sun, { center: [cx, cy, cz], up: [ux, uy, uz] }) : null
  const [lx, ly, lz] = light ?? [0, 0, 1]
  const shown = place !== null && (place.state === 'front' || place.state === 'setting') && map !== null
  useEffect(() => {
    const canvas = earthRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !map || !shown) return
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    const size = Math.round(radius * 2 * scale)
    canvas.width = canvas.height = size
    const picture = context.createImageData(size, size)
    const face = (EARTH_FACE_LON_DEG * Math.PI) / 180
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const x = ((col + 0.5) / size) * 2 - 1
        const y = 1 - ((row + 0.5) / size) * 2
        const rr = x * x + y * y
        if (rr > 1) continue
        // The point of the globe under this pixel, seen from over the equator with north up.
        const z = Math.sqrt(1 - rr)
        const lon = face + Math.atan2(x, z)
        const lat = Math.asin(y)
        const u = Math.min(map.width - 1, Math.floor((((lon / Math.PI + 1) / 2 + 1) % 1) * map.width))
        const v = Math.min(map.height - 1, Math.floor((0.5 - lat / Math.PI) * map.height))
        const from = (v * map.width + u) * 4
        const to = (row * size + col) * 4
        const sunlit = earthShade(x, y, [lx, ly, lz])
        const shade = Math.max(sunlit, EARTH_NIGHT)
        // A rim of air, brightest at the edge: on the day side it is lost in the daylight, on the night
        // side it is a faint blue line, so the whole disc can be seen and a thin crescent reads as a globe.
        const edge = Math.min(1, Math.max(0, (Math.sqrt(rr) - 0.8) / 0.17))
        const rim = edge * edge * (EARTH_RIM_NIGHT + (1 - EARTH_RIM_NIGHT) * sunlit)
        // Earth is far brighter than the Moon's ground: the map's colours are lifted so its day side reads as lit.
        picture.data[to] = Math.min(255, Math.min(255, map.data[from] * 1.4 + 14) * shade + 70 * rim)
        picture.data[to + 1] = Math.min(255, Math.min(255, map.data[from + 1] * 1.4 + 18) * shade + 120 * rim)
        picture.data[to + 2] = Math.min(255, Math.min(255, map.data[from + 2] * 1.4 + 26) * shade + 200 * rim)
        // A soft edge, one pixel wide.
        picture.data[to + 3] = 255 * Math.min(1, (1 - Math.sqrt(rr)) * size * 0.5)
      }
    }
    context.putImageData(picture, 0, 0)
  }, [map, shown, radius, lx, ly, lz])

  const lit = Math.round(earthLitShare([lx, ly, lz]) * 100)
  const says = `Earth, drawn on the side of the Moon it lies toward, with ${lit}% of its face sunlit as now. Not to scale: Earth is much farther away than drawn.`
  return (
    <>
      <canvas ref={starsRef} className="sl-stars" style={{ width: box.width, height: box.height }} data-stars={stars.length} aria-hidden="true" />
      {place && (
        <canvas
          ref={earthRef}
          className="sl-earth"
          data-state={place.state}
          data-lit={lit}
          data-moved={place.movedDeg}
          style={{ left: place.x - radius, top: place.y - radius, width: radius * 2, height: radius * 2, opacity: shown ? place.opacity : 0 }}
          aria-hidden="true"
        />
      )}
      {/* The picture sits under the Moon; this clear spot over it carries its name and the words "not to scale". */}
      {place && shown && place.state === 'front' && place.opacity > 0.5 && (
        <span className="sl-earth-name" role="img" aria-label={says} title={says} style={{ left: place.x - radius, top: place.y - radius, width: radius * 2, height: radius * 2 }} />
      )}
    </>
  )
}
