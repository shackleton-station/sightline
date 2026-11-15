import { useEffect, useMemo, useRef, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { slopePartFor, slopePartNow } from '../data/loadMissionGrid'
import {
  ACCURACY_RANGE,
  ACCURACY_SHARE,
  bestAim,
  cellAtM,
  cellCentreM,
  cellChances,
  FIT_COLOR,
  FITS,
  landingOdds,
  type Miss,
  MISS_COLORS,
  MISS_WORDS,
  MISSES,
  missOf,
  RING_SHARES,
  radiusHolding,
  reachM,
  sigmaM,
  type Spread,
  verdictColor,
} from '../lib/landingOdds'
import { planeLatLon, planeXY } from '../lib/lightGrid'
import { type TrekWindow, trekLayer, trekWindow } from '../lib/trekLayers'
import { useFinePhoto } from '../data/finePhoto'
import { fitMapAround, squareAround } from '../lib/missionGrid'
import type { SightlineMission } from '../lib/sightlineMission'
import { useWidth } from '../lib/useWidth'
import { clock } from './clockFace'
import { LandingExplain } from './LandingExplain'
import { type MissionGrid, REACH_M } from './useMissionGrid'

interface Props {
  site: SiteInfo
  mission: SightlineMission
  grid: MissionGrid
  spread: Spread
  onSpread: (spread: Spread) => void
  /** Move the target to a point (a better place to aim). */
  onAim: (lat: number, lon: number) => void
}

/** How many simulated landers a run drops, and how fast (landers a second). */
const LANDERS = 150
const PER_SECOND = 50
/** How long a lander's touchdown flare lasts (ms). */
const FLARE_MS = 650

interface Lander {
  x: number
  y: number
  /** The verdict where it came down: FITS, a miss code, or -1 off the map. */
  code: number
  /** When it touched down (ms since the run began). */
  at: number
}

/** One draw from the lander's miss: a bell curve, longer along the approach by `stretch`. */
function drop(spread: Spread): { x: number; y: number } {
  const sigma = sigmaM(spread.accuracyM)
  // Box–Muller: two standard normal numbers.
  const u = 1 - Math.random()
  const v = Math.random()
  const r = Math.sqrt(-2 * Math.log(u))
  const along = r * Math.cos(2 * Math.PI * v) * sigma * spread.stretch
  const across = r * Math.sin(2 * Math.PI * v) * sigma
  const b = (spread.bearingDeg * Math.PI) / 180
  // The approach's bearing is clockwise from up (north).
  return { x: along * Math.sin(b) + across * Math.cos(b), y: along * Math.cos(b) - across * Math.sin(b) }
}

/**
 * Where the lander may come down, played out: the ground within reach drawn smooth and large, green
 * where a landing still gets through the mission and in each reason's colour where it doesn't, and
 * simulated landers raining in on the real miss distribution for the accuracy chosen, each leaving a
 * mark. A tally beside it counts how many fit and why the others don't, closing on the odds the model
 * gives. The same map and odds as the main screen's Landing accuracy panel.
 */
export function LandingRain({ site, mission, grid, spread, onSpread, onAim }: Props) {
  const { meta, gaps } = grid
  const { requirements, maxSlopeDeg } = mission
  const [, setArrived] = useState(0)
  const square = useMemo(() => (meta ? squareAround(meta, site.lat, site.lon, REACH_M) : null), [meta, site.lat, site.lon])
  const squareKey = square ? `${square.col},${square.row},${square.cells}` : null
  useEffect(() => {
    if (!meta || !square) return
    let current = true
    void slopePartFor(meta, square).then(() => current && setArrived((count) => count + 1))
    return () => {
      current = false
    }
    // The key names the square: the same key is the same ground.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, squareKey])
  const slope = square ? slopePartNow(square) : undefined
  const map = useMemo(
    () => (meta && gaps && square && slope !== undefined ? fitMapAround(meta, gaps, square, site.lat, site.lon, requirements, maxSlopeDeg, slope) : null),
    [meta, gaps, square, slope, site.lat, site.lon, requirements, maxSlopeDeg],
  )
  const chances = useMemo(() => (map ? cellChances(map, spread) : null), [map, spread])
  const odds = useMemo(() => (map && chances ? landingOdds(map, chances) : null), [map, chances])
  const searchM = map ? Math.max(0, reachM(map) - 1.25 * spread.accuracyM * spread.stretch) : 0
  const aim = useMemo(() => (map && chances && searchM > 0 ? bestAim(map, chances, searchM) : null), [map, chances, searchM])
  const viewM = map && meta ? Math.min(Math.max(1.6 * spread.accuracyM * spread.stretch, 2 * meta.pixel_m), reachM(map)) : 0

  // The slider: shown at once, applied when it rests, so the odds and the better aim are worked out once.
  // Every scatter control (here and in "How this works") goes through one draft, applied when it rests.
  const [draft, setDraft] = useState<Spread | null>(null)
  useEffect(() => {
    if (draft === null || (draft.accuracyM === spread.accuracyM && draft.stretch === spread.stretch && draft.bearingDeg === spread.bearingDeg)) return
    const wait = window.setTimeout(() => onSpread(draft), 250)
    return () => window.clearTimeout(wait)
  }, [draft, spread, onSpread])
  const shownSpread = draft ?? spread
  const shownM = shownSpread.accuracyM

  // The run: landers fall in over time; a new run starts when the ground or the accuracy changes.
  const [landers, setLanders] = useState<Lander[]>([])
  const [playing, setPlaying] = useState(false)
  const [runKey, setRunKey] = useState(0)
  const started = useRef(0)
  // Only the button plays landers in; anything else shows them already down.
  const wantPlay = useRef(false)
  const runFor = `${squareKey}|${spread.accuracyM}|${spread.stretch}|${spread.bearingDeg}|${map ? map.verdict.length : 0}|${requirements.missionDays}|${requirements.maxSunGapH}|${requirements.maxEarthGapH}|${maxSlopeDeg}|${runKey}`
  const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (!map) return
    const land = (at: number): Lander => {
      const { x, y } = drop(spread)
      const cell = cellAtM(map, x, y)
      return { x, y, code: cell === null ? -1 : map.verdict[cell], at }
    }
    // A new ground or accuracy shows its landers already down; "Drop landers" plays them in.
    if (!wantPlay.current || still) {
      setLanders(Array.from({ length: LANDERS }, () => land(-FLARE_MS)))
      setPlaying(false)
      return
    }
    wantPlay.current = false
    setLanders([])
    started.current = performance.now()
    setPlaying(true)
    // The ground and spread for this run are fixed; its key names them.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [runFor])

  useEffect(() => {
    if (!map || still || !playing) return
    let frame = 0
    let carried = landers.length
    let lastDraw = 0
    const tick = (time: number) => {
      const elapsed = time - started.current
      const due = Math.min(LANDERS, Math.floor((elapsed / 1000) * PER_SECOND))
      if (due > carried) {
        const fresh: Lander[] = []
        for (let i = carried; i < due; i += 1) {
          const { x, y } = drop(spread)
          const cell = cellAtM(map, x, y)
          fresh.push({ x, y, code: cell === null ? -1 : map.verdict[cell], at: elapsed })
        }
        carried = due
        setLanders((before) => [...before, ...fresh])
      } else if (time - lastDraw > 50) {
        // Keep drawing while the last flares fade, a few times a second.
        lastDraw = time
        setLanders((before) => before.slice())
      }
      if (carried >= LANDERS && elapsed > (LANDERS / PER_SECOND) * 1000 + FLARE_MS) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [map, playing, still, runFor])

  // The picture: the ground drawn smooth from the grid's own cells, rings, target, aim and the landers.
  const [box, width] = useWidth()
  const canvas = useRef<HTMLCanvasElement>(null)
  const ground = useMemo(() => {
    if (!map || viewM === 0) return null
    // One pixel per cell, then scaled up with smoothing: the cells' colours blend instead of showing as blocks.
    const side = Math.max(1, Math.round((2 * viewM) / map.cellM) + 2)
    const off = document.createElement('canvas')
    off.width = side
    off.height = side
    const g = off.getContext('2d')
    if (!g) return null
    for (let at = 0; at < map.verdict.length; at += 1) {
      const { x, y } = cellCentreM(map, at)
      const i = Math.round((x + viewM) / map.cellM)
      const j = Math.round((viewM - y) / map.cellM)
      if (i < 0 || j < 0 || i >= side || j >= side) continue
      g.fillStyle = verdictColor(map.verdict[at])
      g.fillRect(i, j, 1, 1)
    }
    return off
  }, [map, viewM])

  // The real ground under the colours: LROC's south-pole photo mosaic (our 1 m tiles round the ridge
  // sites, Moon Trek's elsewhere), cut for this square. The light grid and Moon Trek's map share one
  // projection (polar stereographic, x toward 90° E, y toward 0° E, the same radius), so its metres
  // are the fit map's metres.
  const fine = useFinePhoto(true)
  const [photo, setPhoto] = useState<{ key: string; win: TrekWindow; image: HTMLCanvasElement } | null>(null)
  const sidePx = Math.min(width, 600)
  const photoKey = meta && viewM > 0 && sidePx > 0 ? `${site.id}|${Math.round(viewM)}|${Math.round(sidePx)}|${fine ? 'fine' : 'trek'}` : null
  useEffect(() => {
    if (!meta || !photoKey) return
    const layer = trekLayer('photo')
    if (!layer) return
    const middle = planeXY(meta, site.lat, site.lon)
    const ratio = window.devicePixelRatio || 1
    const win = trekWindow(layer, middle, viewM * 1.05, (2 * viewM) / (sidePx * ratio), fine)
    if (!win) return
    let current = true
    const load = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = url
      })
    const out = document.createElement('canvas')
    out.width = win.widthPx
    out.height = win.heightPx
    const g = out.getContext('2d')
    if (!g) return
    Promise.all(
      win.tiles.map(async (tile) => {
        try {
          const image = await load(tile.url)
          if (tile.crop) g.drawImage(image, tile.crop.sx, tile.crop.sy, tile.crop.size, tile.crop.size, tile.x, tile.y, 256, 256)
          else g.drawImage(image, tile.x, tile.y, 256, 256)
        } catch {
          if (!tile.or) return
          try {
            const image = await load(tile.or.url)
            g.drawImage(image, tile.or.crop.sx, tile.or.crop.sy, tile.or.crop.size, tile.or.crop.size, tile.x, tile.y, 256, 256)
          } catch {
            // A missing tile stays dark; the colours still say what the ground does.
          }
        }
      }),
    ).then(() => current && setPhoto({ key: photoKey, win, image: out }))
    return () => {
      current = false
    }
    // The key names the site, the square and the size.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey])
  const shownPhoto = photo?.key === photoKey ? photo : null

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || !map || !ground || width === 0) return
    const side = Math.min(width, 600)
    const ratio = window.devicePixelRatio || 1
    element.style.width = `${side}px`
    element.style.height = `${side}px`
    element.width = Math.round(side * ratio)
    element.height = Math.round(side * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const perM = side / (2 * viewM)
    const px = (x: number) => (x + viewM) * perM
    const py = (y: number) => (viewM - y) * perM

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    const cellPx = map.cellM * perM
    if (shownPhoto && meta) {
      // The photo, placed by its own metres round the target; then the verdicts laid over it as colour
      // only, so the craters, ridges and shadows keep their own light and dark.
      const { win, image } = shownPhoto
      const middle = planeXY(meta, site.lat, site.lon)
      const left = win.centreXM - win.halfWidthM - middle.x
      const top = win.centreYM + win.halfHeightM - middle.y
      context.fillStyle = '#000'
      context.fillRect(0, 0, side, side)
      context.drawImage(image, px(left), py(top), win.widthPx * win.metresPerPixel * perM, win.heightPx * win.metresPerPixel * perM)
      context.globalCompositeOperation = 'color'
      context.globalAlpha = 0.85
      context.drawImage(ground, -cellPx / 2, -cellPx / 2, side + cellPx, side + cellPx)
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 0.16
      context.drawImage(ground, -cellPx / 2, -cellPx / 2, side + cellPx, side + cellPx)
      context.globalAlpha = 1
    } else {
      context.globalAlpha = 0.78
      context.drawImage(ground, -cellPx / 2, -cellPx / 2, side + cellPx, side + cellPx)
      context.globalAlpha = 1
    }
    // A soft vignette, so the eye goes to the middle.
    const shade = context.createRadialGradient(side / 2, side / 2, side * 0.25, side / 2, side / 2, side * 0.75)
    shade.addColorStop(0, 'rgb(0 0 0 / 0%)')
    shade.addColorStop(1, 'rgb(0 0 0 / 45%)')
    context.fillStyle = shade
    context.fillRect(0, 0, side, side)

    // The rings holding 50%, 90% and 99% of landings.
    const sigma = sigmaM(spread.accuracyM)
    const turn = (spread.bearingDeg * Math.PI) / 180 - Math.PI / 2
    for (const share of RING_SHARES) {
      const across = radiusHolding(share, sigma) * perM
      context.strokeStyle = share === 0.99 ? 'rgb(255 255 255 / 90%)' : 'rgb(255 255 255 / 55%)'
      context.lineWidth = share === 0.99 ? 1.5 : 1
      context.setLineDash(share === 0.99 ? [] : [5, 4])
      context.beginPath()
      context.ellipse(px(0), py(0), across * spread.stretch, across, turn, 0, 2 * Math.PI)
      context.stroke()
    }
    context.setLineDash([])

    // The landers: a mark where each came down, and a flare as it touches down.
    const now = performance.now() - started.current
    for (const lander of landers) {
      const age = now - lander.at
      const fits = lander.code === FITS
      const miss = missOf(lander.code)
      const colour = fits ? '#9ff0c4' : miss ? MISS_COLORS[miss] : '#ffffff'
      const x = px(lander.x)
      const y = py(lander.y)
      if (age < FLARE_MS && !still) {
        const t = age / FLARE_MS
        context.strokeStyle = colour
        context.globalAlpha = 1 - t
        context.lineWidth = 2
        context.beginPath()
        context.arc(x, y, 3 + 14 * t, 0, 2 * Math.PI)
        context.stroke()
        context.globalAlpha = 1
      }
      context.fillStyle = 'rgb(0 0 0 / 60%)'
      context.beginPath()
      context.arc(x, y, 3.2, 0, 2 * Math.PI)
      context.fill()
      context.fillStyle = colour
      context.beginPath()
      context.arc(x, y, 2.2, 0, 2 * Math.PI)
      context.fill()
    }

    // The target and a better place to aim.
    const edged = (draw: () => void) => {
      for (const [color, w] of [
        ['rgb(0 0 0 / 70%)', 4],
        ['#fff', 1.75],
      ] as const) {
        context.strokeStyle = color
        context.lineWidth = w
        context.beginPath()
        draw()
        context.stroke()
      }
    }
    edged(() => {
      context.moveTo(px(0) - 7, py(0))
      context.lineTo(px(0) + 7, py(0))
      context.moveTo(px(0), py(0) - 7)
      context.lineTo(px(0), py(0) + 7)
    })
    if (aim && Math.abs(aim.x) <= viewM && Math.abs(aim.y) <= viewM) {
      edged(() => {
        context.moveTo(px(aim.x), py(aim.y) - 8)
        context.lineTo(px(aim.x) + 8, py(aim.y))
        context.lineTo(px(aim.x), py(aim.y) + 8)
        context.lineTo(px(aim.x) - 8, py(aim.y))
        context.closePath()
      })
    }

    // A scale bar.
    const bars = [25, 50, 100, 200, 250, 500, 1000]
    const barM = bars.filter((length) => length * perM <= side / 3).at(-1) ?? bars[0]
    context.fillStyle = 'rgb(0 0 0 / 55%)'
    context.fillRect(6, side - 28, barM * perM + 10, 22)
    context.fillStyle = '#fff'
    context.fillRect(11, side - 12, barM * perM, 2)
    context.font = '11px system-ui, sans-serif'
    context.fillText(`${barM} m`, 11, side - 16)
  }, [map, ground, landers, width, viewM, spread, aim, still, shownPhoto, meta, site.lat, site.lon])

  if (meta === null || grid.state === 'failed') return <p className="sl-quiet">The light grid could not be read.</p>
  if (grid.state === 'past') return <p className="sl-quiet">The mission runs past the last month of the light grid, so the ground around this landing can't be judged.</p>
  if (meta && !square) return <p className="sl-quiet">{site.name} is outside the light grid, which covers the ground within about {Math.round(meta.half_width_m / 1000)} km of the south pole.</p>
  if (!meta || !map || !odds) return <p className="sl-quiet">Reading the ground around {site.name}…</p>

  // The tally so far: how many fit, and why the rest don't.
  const down = landers.length
  const fitCount = landers.filter((lander) => lander.code === FITS).length
  const byMiss = new Map<Miss, number>()
  for (const lander of landers) {
    const miss = missOf(lander.code)
    if (miss) byMiss.set(miss, (byMiss.get(miss) ?? 0) + 1)
  }
  const offMap = landers.filter((lander) => lander.code === -1).length
  const shown = MISSES.filter((miss) => (byMiss.get(miss) ?? 0) > 0 || odds.misses[miss] >= 0.005)
  const pct = (n: number) => (down === 0 ? 0 : Math.round((100 * n) / down))
  const better = aim && aim.fit > odds.fit + 0.005 ? aim : null
  const takeAim = () => {
    if (!aim || !meta) return
    const target = planeXY(meta, site.lat, site.lon)
    const { lat, lon } = planeLatLon(meta, target.x + aim.x, target.y + aim.y)
    onAim(Number(lat.toFixed(6)), Number(lon.toFixed(6)))
  }

  return (
    <div className="np-rain">
      {better ? (
        <p className="np-act">
          <button type="button" className="np-act-go" onClick={takeAim} title="Move the target to the better place to aim, marked with a diamond on the map">
            ◆ Aim {Math.round(Math.hypot(better.x, better.y))} m away at {clock(better.x, better.y)}
          </button>
          <span>
            <b className="is-better">{Math.round(better.fit * 100)}%</b> of landings fit instead of <b>{Math.round(odds.fit * 100)}%</b>
          </span>
        </p>
      ) : (
        <p className="np-act is-done">
          <span>✓ Your target is already the best place to aim within reach: {Math.round(odds.fit * 100)}% of landings fit.</span>
        </p>
      )}
      <div className="np-rain-stage" ref={box}>
        <canvas ref={canvas} role="img" aria-label={`Simulated landings around ${site.name}: ${pct(fitCount)}% of ${down} so far came down where the mission fits; the model gives ${Math.round(odds.fit * 100)}%.`} />
      </div>
      <div className="np-rain-side">
        <p className="np-rain-big">
          <strong>{down === 0 ? '…' : `${pct(fitCount)}%`}</strong>
          <span>
            of {down} simulated landers came down where the mission fits
            <br />
            <small>the model's odds: {Math.round(odds.fit * 100)}%</small>
          </span>
        </p>
        <div className="np-rain-bars">
          <div className="np-rain-bar">
            <span className="np-rain-name">
              <i style={{ background: FIT_COLOR }} /> fits
            </span>
            <span className="np-rain-track">
              <b style={{ width: `${pct(fitCount)}%`, background: FIT_COLOR }} />
            </span>
            <span className="np-rain-n">{fitCount}</span>
          </div>
          {shown.map((miss) => (
            <div key={miss} className="np-rain-bar">
              <span className="np-rain-name">
                <i style={{ background: MISS_COLORS[miss] }} /> {MISS_WORDS[miss]}
              </span>
              <span className="np-rain-track">
                <b style={{ width: `${pct(byMiss.get(miss) ?? 0)}%`, background: MISS_COLORS[miss] }} />
              </span>
              <span className="np-rain-n">{byMiss.get(miss) ?? 0}</span>
            </div>
          ))}
          {offMap > 0 && (
            <div className="np-rain-bar">
              <span className="np-rain-name">
                <i style={{ background: '#fff' }} /> beyond the map
              </span>
              <span className="np-rain-track">
                <b style={{ width: `${pct(offMap)}%`, background: '#fff' }} />
              </span>
              <span className="np-rain-n">{offMap}</span>
            </div>
          )}
        </div>
        <label className="np-rain-acc">
          <span>
            {Math.round(100 * ACCURACY_SHARE)}% of landings within <b>{shownM} m</b>
          </span>
          <input type="range" min={ACCURACY_RANGE.min} max={ACCURACY_RANGE.max} step={ACCURACY_RANGE.step} value={shownM} onChange={(event) => setDraft({ ...shownSpread, accuracyM: Number(event.target.value) })} />
        </label>
        <p className="np-rain-actions">
          {!still && (
            <button type="button" className="sl-small" onClick={() => (playing ? setPlaying(false) : down >= LANDERS ? ((wantPlay.current = true), setRunKey((key) => key + 1)) : setPlaying(true))}>
              {playing ? '❚❚ Pause' : down >= LANDERS ? '▶ Drop landers' : '▶ Go on'}
            </button>
          )}
        </p>
        <p className="np-rain-credit">{shownPhoto ? `Ground: ${shownPhoto.win.title} (LROC, NASA/GSFC/Arizona State University), tinted by what a landing there does.` : 'Loading the photo of the ground…'}</p>
        <p className="np-rain-key">
          <span>
            <i className="is-ring" /> 50%, 90% and 99% of landings
          </span>
          <span>
            <i className="is-target" /> the target
          </span>
          {better && (
            <span>
              <i className="is-aim" /> a better aim
            </span>
          )}
        </p>
      </div>
      <LandingExplain map={map} viewM={viewM} odds={odds} spread={shownSpread} onSpread={setDraft} simulated={{ down, fit: fitCount }} cellM={map.cellM} />
    </div>
  )
}
