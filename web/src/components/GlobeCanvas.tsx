import { useEffect, useRef } from 'react'
import { loadPart } from '../data/staleBuild'
import type { GlobeView } from '../lib/globe'
import { LIGHT_URLS } from '../atlas/useLightGrid'
import type { LightMeta, LightMonth } from '../lib/lightGrid'
import type { GlobeFrame, GlobeOverlay, GlobeOverlayDetail, GlobeViewer, GlobeShade, GroundDetail, SlopeMaps } from '../three/GlobeViewer'
import type { LightView } from '../three/lightLayer'

const BASE = `${import.meta.env.BASE_URL}data/maps/`
/** Device pixels across the canvas above which the 2K color map starts to look soft. */
const SHARP_ABOVE_PX = 1000
/**
 * Device pixels across the Moon's disc above which the 8K color map is fetched. The 4K one's 4,096
 * pixels round the Moon are 4096/π, about 1,300, across the middle of the disc; at 2,000 each of
 * its pixels covers a pixel and a half of screen and the softness shows. A first view on a laptop
 * stays under this, so the 30 MB file is fetched only by someone who zooms in.
 */
const COLOR_8K_ABOVE_PX = 2000
/** South of this latitude the globe draws the polar ground in plain gray, not the color map (GlobeViewer's shader), so a sharper color map would not show. */
const COLOR_ENDS_LAT_DEG = -80
/** The 8K map, compressed for the graphics card (pipeline/scripts/make_color_8k.py). Too big for Git: it is in the bucket, with the whole-Moon tiles. */
const COLOR_8K = { url: `${import.meta.env.BASE_URL}tiles/global/color/moon_color_8k.ktx2`, transcoderPath: `${import.meta.env.BASE_URL}basis/` }
/**
 * Device pixels across the Moon's disc above which the smaller slope maps start to look soft, and
 * the full ones are fetched: the whole-Moon pair (2048 pixels round the Moon at first), and the
 * polar pair (600 m a pixel at first).
 */
const MOON_SLOPES_SHARP_ABOVE_PX = 1700
const POLE_SLOPES_SHARP_ABOVE_PX = 7000

/** Asks the globe for its 8K color map (once), and marks the canvas when it is in use: for the page's checks. */
function sharpenColor(viewer: GlobeViewer, canvas: HTMLCanvasElement): void {
  void viewer.sharpenColor().then((bytes) => {
    if (bytes === 0) return
    canvas.dataset.color = '8k'
    canvas.dataset.colorMb = (bytes / 1e6).toFixed(1)
  })
}

interface Props {
  view: GlobeView
  zoom: number
  /** Unit vector toward the Sun in MOON_ME, from the pipeline; null lights the globe evenly. */
  sun: [number, number, number] | null
  /** Which way is up the screen, as a MOON_ME unit vector (from the camera); north when left out. */
  up?: readonly [number, number, number]
  /** Unit vector toward Earth in MOON_ME, from the pipeline: with it the night side facing Earth is faintly lit by earthshine. */
  earth?: readonly [number, number, number] | null
  /** NASA's natural-color map on top of our relief, or relief alone. */
  color?: boolean
  /** Light the ground by its real slopes (LOLA), with a map of the south pole. About 5 MB more, loaded last. */
  terrain?: boolean
  /** A picture laid over the ground around the south pole (a Moon Trek layer), or none. Keep the same object while it is on. */
  overlay?: GlobeOverlay | null
  /** A transparent shade over the whole Moon, or none. */
  shade?: GlobeShade | null
  /** A sharper picture of the ground in view, laid over `overlay` where it reaches, or none. Keep the same object while it is on. */
  overlayDetail?: GlobeOverlayDetail | null
  /** A photo of the ground in view, for the Moon's own picture to get sharper from (GlobeViewer `setGroundDetail`); for when no layer is on. */
  ground?: GroundDetail | null
  /**
   * The pipeline's light grid for the ground around the south pole (as the Atlas draws it): its
   * description, the month's data for the fine and the wide grid once they arrive, and the hour to
   * show with what to colour by. The description decides how the globe is built, so pass it from the
   * first draw (null for no grid); `lightShow` null leaves the grid off.
   */
  lightMeta?: LightMeta | null
  lightMonth?: LightMonth | null
  lightWide?: LightMonth | null
  lightShow?: { hour: number; view: LightView } | null
  /** The canvas's width in CSS pixels, for fitting labels. */
  onSize?: (px: number) => void
  /** The browser took the graphics away. */
  onLost: () => void
  /** The Moon has been drawn for the first time. */
  onDrawn?: () => void
}

/** What the pipeline wrote about its slope maps (`pipeline/scripts/make_slope_maps.py`). */
interface SlopesFile {
  slope_max: number
  pole: { half_width_m: number; x_axis_lon_deg: number; y_axis_lon_deg: number; radius_m: number }
}

/** Where the slope maps are and how to read them, or null if they aren't there. */
async function slopeMaps(): Promise<SlopeMaps | null> {
  try {
    const response = await fetch(`${BASE}slopes.json`)
    if (!response.ok) return null
    const file = (await response.json()) as SlopesFile
    return {
      moon: [`${BASE}moon_slope_e.jpg`, `${BASE}moon_slope_n.jpg`],
      pole: [`${BASE}pole_slope_x.jpg`, `${BASE}pole_slope_y.jpg`],
      // Smaller copies (pipeline/scripts/make_first_maps.py) load first; the full ones when the view is close enough to need them.
      moonFirst: [`${BASE}moon_slope_e_2k.jpg`, `${BASE}moon_slope_n_2k.jpg`],
      poleFirst: [`${BASE}pole_slope_x_1k.jpg`, `${BASE}pole_slope_y_1k.jpg`],
      slopeMax: file.slope_max,
      poleHalfWidthM: file.pole.half_width_m,
      radiusM: file.pole.radius_m,
      poleXLonDeg: file.pole.x_axis_lon_deg,
      poleYLonDeg: file.pole.y_axis_lon_deg,
    }
  } catch {
    return null
  }
}

/**
 * The globe itself: one canvas drawn by the Three.js GlobeViewer, only when the view, zoom or Sun
 * changes. Three.js downloads with the first globe, not with the rest of the page.
 */
export function GlobeCanvas({ view, zoom, sun, up, earth = null, color = false, terrain = false, overlay = null, shade = null, overlayDetail = null, ground = null, lightMeta = null, lightMonth = null, lightWide = null, lightShow = null, onSize, onLost, onDrawn }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<GlobeViewer | null>(null)
  const frameRef = useRef<GlobeFrame>({ view, zoom, sun, up, earth, light: lightShow ?? undefined })
  const monthsRef = useRef({ fine: lightMonth, wide: lightWide })
  // Callers often pass a new arrow function each render. Keeping the latest in a ref means the
  // viewer is built once per canvas, not rebuilt (and its maps reloaded) on every frame.
  const onLostRef = useRef(onLost)
  const onSizeRef = useRef(onSize)
  const onDrawnRef = useRef(onDrawn)
  const overlayRef = useRef(overlay)
  const shadeRef = useRef(shade)
  const detailRef = useRef(overlayDetail)
  const groundRef = useRef(ground)
  useEffect(() => {
    frameRef.current = { view, zoom, sun, up, earth, light: lightShow ?? undefined }
    monthsRef.current = { fine: lightMonth, wide: lightWide }
    onLostRef.current = onLost
    onSizeRef.current = onSize
    onDrawnRef.current = onDrawn
    overlayRef.current = overlay
    shadeRef.current = shade
    detailRef.current = overlayDetail
    groundRef.current = ground
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const lost = () => onLostRef.current()
    // The 4K map only where the canvas has the pixels to show it (large or high-density screens).
    const sharp = canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2) > SHARP_ABOVE_PX
    // A small color map first, then the 2K one, then the 4K one where the screen can show it.
    const colorUrls = color ? [`${BASE}moon_color_first.jpg`, `${BASE}moon_color.jpg`, ...(sharp ? [`${BASE}moon_color_4k.jpg`] : [])] : []
    Promise.all([loadPart(() => import('../three/GlobeViewer')), terrain ? slopeMaps() : null])
      .then(([{ GlobeViewer }, slopes]) => {
        if (cancelled) return
        if (typeof WebGL2RenderingContext === 'undefined') throw new Error('WebGL2 is not available')
        const light = lightMeta && {
          size: lightMeta.size,
          halfWidthM: lightMeta.half_width_m,
          radiusM: lightMeta.radius_m,
          xLonDeg: lightMeta.x_axis_lon_deg,
          yLonDeg: lightMeta.y_axis_lon_deg,
          slopeUrls: LIGHT_URLS.slopes,
          wide: lightMeta.wide ? { size: lightMeta.wide.size, halfWidthM: lightMeta.wide.half_width_m } : null,
        }
        const viewer = new GlobeViewer({
          canvas,
          reliefFirstUrl: `${BASE}moon_first.jpg`,
          reliefUrl: `${BASE}moon_relief.jpg`,
          colorUrls,
          // The 8K map is for laptops and desktops; a phone's screen is served by the 4K one.
          colorSharp: color && window.matchMedia('(hover: hover) and (pointer: fine)').matches ? COLOR_8K : null,
          onLost: lost,
          // For the page's checks: how long after the page opened the Moon was first drawn.
          onFirstDraw: () => {
            canvas.dataset.drawnMs = String(Math.round(performance.now()))
            onDrawnRef.current?.()
          },
          slopes,
          light,
        })
        // Months that arrived before the viewer did.
        if (monthsRef.current.fine) viewer.setLightMonth(monthsRef.current.fine)
        if (monthsRef.current.wide) viewer.setLightMonth(monthsRef.current.wide, 'wide')
        viewerRef.current = viewer
        // A view that opens close enough for the full slope maps asks for them at once.
        const discPx = frameRef.current.zoom * canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)
        if (terrain && discPx > MOON_SLOPES_SHARP_ABOVE_PX) viewer.sharpenTerrain('moon')
        if (terrain && discPx > POLE_SLOPES_SHARP_ABOVE_PX) viewer.sharpenTerrain('pole')
        if (discPx > COLOR_8K_ABOVE_PX && frameRef.current.view.lat > COLOR_ENDS_LAT_DEG) sharpenColor(viewer, canvas)
        // A layer switched on before the viewer was ready.
        if (overlayRef.current) viewer.setOverlay(overlayRef.current)
        if (shadeRef.current) viewer.setShade(shadeRef.current)
        if (detailRef.current) viewer.setOverlayDetail(detailRef.current)
        if (groundRef.current) viewer.setGroundDetail(groundRef.current)
        viewer.draw(frameRef.current)
      })
      .catch(() => {
        if (!cancelled) lost()
      })
    const resize = new ResizeObserver(() => {
      onSizeRef.current?.(canvas.clientWidth)
      viewerRef.current?.draw(frameRef.current)
    })
    resize.observe(canvas)
    return () => {
      cancelled = true
      resize.disconnect()
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [color, terrain, lightMeta])

  useEffect(() => {
    viewerRef.current?.setLightMonth(lightMonth)
  }, [lightMonth])
  useEffect(() => {
    viewerRef.current?.setLightMonth(lightWide, 'wide')
  }, [lightWide])

  const [sunX, sunY, sunZ] = sun ?? [Number.NaN, Number.NaN, Number.NaN]
  const [upX, upY, upZ] = up ?? [Number.NaN, Number.NaN, Number.NaN]
  const [earthX, earthY, earthZ] = earth ?? [Number.NaN, Number.NaN, Number.NaN]
  useEffect(() => {
    viewerRef.current?.draw(frameRef.current)
    // Close enough for the smaller slope maps to look soft: fetch the full ones (once).
    const canvas = canvasRef.current
    const viewer = viewerRef.current
    if (!canvas || !viewer) return
    const discPx = zoom * canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)
    if (discPx > COLOR_8K_ABOVE_PX && view.lat > COLOR_ENDS_LAT_DEG) sharpenColor(viewer, canvas)
    if (!terrain) return
    if (discPx > MOON_SLOPES_SHARP_ABOVE_PX) viewer.sharpenTerrain('moon')
    if (discPx > POLE_SLOPES_SHARP_ABOVE_PX) viewer.sharpenTerrain('pole')
  }, [view.lat, view.lon, zoom, sunX, sunY, sunZ, upX, upY, upZ, earthX, earthY, earthZ, lightShow?.hour, lightShow?.view, lightMonth, lightWide, terrain])

  useEffect(() => {
    viewerRef.current?.setShade(shade)
    if (canvasRef.current) canvasRef.current.dataset.shade = shade ? (shade.polar ? 'whole' : 'wash') : 'off'
  }, [shade])
  useEffect(() => {
    viewerRef.current?.setOverlay(overlay)
    // For the page's checks: whether a layer's picture has been handed to the globe.
    if (canvasRef.current) canvasRef.current.dataset.overlay = overlay ? 'on' : 'off'
  }, [overlay])
  useEffect(() => {
    viewerRef.current?.setOverlayDetail(overlayDetail)
    if (canvasRef.current) canvasRef.current.dataset.overlayDetail = overlayDetail ? 'on' : 'off'
  }, [overlayDetail])
  useEffect(() => {
    viewerRef.current?.setGroundDetail(ground)
    if (canvasRef.current) canvasRef.current.dataset.ground = ground ? 'on' : 'off'
  }, [ground])

  return <canvas ref={canvasRef} />
}
