import { useEffect, useRef } from 'react'
import { cellAtM, cellCentreM, FIT_COLOR, type FitMap, FITS, MISS_COLOR, RING_SHARES, radiusHolding } from '../lib/landingOdds'

const SCALE_BARS_M = [25, 50, 100, 200, 250, 500, 1000]

interface Props {
  map: FitMap
  /** The bell curve's spread (m), for the rings. */
  sigma: number
  /** How far from the target the picture reaches, each way (m). */
  viewM: number
  /** The cell picked, outlined; null for none. */
  picked: number | null
  onPick: (cell: number | null) => void
  /** What the picture shows, in words, for a screen reader. */
  label: string
}

/**
 * The ground around the target, each cell green where a landing fits the mission and red where it
 * does not, with the target at the centre and a ring for each share of landings. Tapping a cell
 * picks it. The picture is in the terrain's own map plane, so distances on it are true.
 */
export function AccuracyMap({ map, sigma, viewM, picked, onPick, label }: Props) {
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
      context.fillStyle = map.verdict[at] === FITS ? FIT_COLOR : MISS_COLOR
      // A hair of overlap, so no seams show between cells at odd sizes.
      context.fillRect(px(x) - cell / 2, py(y) - cell / 2, cell + 0.5, cell + 0.5)
    }

    context.strokeStyle = 'rgb(255 255 255 / 85%)'
    context.lineWidth = 1.25
    for (const share of RING_SHARES) {
      context.setLineDash(share === 0.99 ? [] : [4, 3])
      context.beginPath()
      context.arc(px(0), py(0), radiusHolding(share, sigma) * perM, 0, 2 * Math.PI)
      context.stroke()
    }
    context.setLineDash([])

    // The target: a cross with a dark edge, readable on either color.
    for (const [color, width] of [
      ['rgb(0 0 0 / 70%)', 4],
      ['#fff', 1.75],
    ] as const) {
      context.strokeStyle = color
      context.lineWidth = width
      context.beginPath()
      context.moveTo(px(0) - 6, py(0))
      context.lineTo(px(0) + 6, py(0))
      context.moveTo(px(0), py(0) - 6)
      context.lineTo(px(0), py(0) + 6)
      context.stroke()
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
  }, [map, sigma, viewM, picked])

  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * 2 * viewM - viewM
    const y = viewM - ((event.clientY - box.top) / box.height) * 2 * viewM
    const cell = cellAtM(map, x, y)
    onPick(cell === picked ? null : cell)
  }

  return <canvas ref={canvas} className="sl-accuracy-map" role="img" aria-label={label} onPointerDown={pick} />
}
