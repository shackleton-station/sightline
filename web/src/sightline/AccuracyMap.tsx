import { useEffect, useRef } from 'react'
import { type Aim, cellAtM, cellCentreM, type FitMap, RING_SHARES, radiusHolding, sigmaM, type Spread, verdictColor } from '../lib/landingOdds'

const SCALE_BARS_M = [25, 50, 100, 200, 250, 500, 1000]

interface Props {
  map: FitMap
  /** How the lander's misses are spread, for the outlines. */
  spread: Spread
  /** How far from the target the picture reaches, each way (m). */
  viewM: number
  /** A better place to aim, marked with a diamond; null for none. */
  aim: Aim | null
  /** The cell picked, outlined; null for none. */
  picked: number | null
  onPick: (cell: number | null) => void
  /** What the picture shows, in words, for a screen reader. */
  label: string
}

/**
 * The ground around the target, each cell green where a landing fits the mission and in its
 * reason's color where it does not, with the target at the centre and an outline for each share of
 * landings. Tapping a cell picks it. The picture is in the terrain's own map plane, so distances
 * on it are true.
 */
export function AccuracyMap({ map, spread, viewM, aim, picked, onPick, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const side = element.clientWidth
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(side * ratio)
    element.height = Math.round(side * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, side, side)
    const perM = side / (2 * viewM)
    const px = (x: number) => (x + viewM) * perM
    const py = (y: number) => (viewM - y) * perM
    const cell = map.cellM * perM

    for (let at = 0; at < map.verdict.length; at += 1) {
      const { x, y } = cellCentreM(map, at)
      if (Math.abs(x) > viewM + map.cellM || Math.abs(y) > viewM + map.cellM) continue
      context.fillStyle = verdictColor(map.verdict[at])
      // A hair of overlap, so no seams show between cells at odd sizes.
      context.fillRect(px(x) - cell / 2, py(y) - cell / 2, cell + 0.5, cell + 0.5)
    }

    // The outlines: circles, or ellipses with the long way along the approach (clockwise from up).
    const sigma = sigmaM(spread.accuracyM)
    const turn = (spread.bearingDeg * Math.PI) / 180 - Math.PI / 2
    context.strokeStyle = 'rgb(255 255 255 / 85%)'
    context.lineWidth = 1.25
    for (const share of RING_SHARES) {
      const across = radiusHolding(share, sigma) * perM
      context.setLineDash(share === 0.99 ? [] : [4, 3])
      context.beginPath()
      context.ellipse(px(0), py(0), across * spread.stretch, across, turn, 0, 2 * Math.PI)
      context.stroke()
    }
    context.setLineDash([])

    // The target: a cross with a dark edge, readable on any of the colors.
    const edged = (draw: () => void) => {
      for (const [color, width] of [
        ['rgb(0 0 0 / 70%)', 4],
        ['#fff', 1.75],
      ] as const) {
        context.strokeStyle = color
        context.lineWidth = width
        context.beginPath()
        draw()
        context.stroke()
      }
    }
    edged(() => {
      context.moveTo(px(0) - 6, py(0))
      context.lineTo(px(0) + 6, py(0))
      context.moveTo(px(0), py(0) - 6)
      context.lineTo(px(0), py(0) + 6)
    })

    // A better place to aim: a diamond, if it is on the picture.
    if (aim && Math.abs(aim.x) <= viewM && Math.abs(aim.y) <= viewM) {
      edged(() => {
        context.moveTo(px(aim.x), py(aim.y) - 7)
        context.lineTo(px(aim.x) + 7, py(aim.y))
        context.lineTo(px(aim.x), py(aim.y) + 7)
        context.lineTo(px(aim.x) - 7, py(aim.y))
        context.closePath()
      })
    }

    if (picked !== null) {
      const { x, y } = cellCentreM(map, picked)
      context.strokeStyle = '#fff'
      context.lineWidth = 2
      context.strokeRect(px(x) - cell / 2, py(y) - cell / 2, cell, cell)
    }

    // A scale bar: the longest round length under a third of the picture.
    const barM = SCALE_BARS_M.filter((length) => length * perM <= side / 3).at(-1) ?? SCALE_BARS_M[0]
    const left = 8
    const base = side - 10
    context.fillStyle = 'rgb(0 0 0 / 55%)'
    context.fillRect(left - 4, base - 16, barM * perM + 8, 22)
    context.fillStyle = '#fff'
    context.fillRect(left, base, barM * perM, 2)
    context.font = '11px system-ui, sans-serif'
    context.fillText(`${barM} m`, left, base - 4)
  }, [map, spread, viewM, aim, picked])

  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * 2 * viewM - viewM
    const y = viewM - ((event.clientY - box.top) / box.height) * 2 * viewM
    const cell = cellAtM(map, x, y)
    onPick(cell === picked ? null : cell)
  }

  return <canvas ref={canvas} className="sl-accuracy-map" role="img" aria-label={label} onPointerDown={pick} />
}
