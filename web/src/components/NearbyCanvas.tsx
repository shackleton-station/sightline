import { useEffect, useRef } from 'react'
import type { NearbyData } from '../data/loadNearby'
import {
  cellValue,
  centerCell,
  goodnessPct,
  largestGapH,
  type NearbyMetric,
  withinSlope,
} from '../lib/nearby'

interface Props {
  data: NearbyData
  metric: NearbyMetric
  limitDeg: number | null
  /** The chosen cell, and the cell the page is showing if it isn't the anchor site. */
  selected: number
  current: number | null
  /** The best places, numbered on the map. */
  spots: number[]
  label: string
  onSelect: (cell: number) => void
  /** The cell under a mouse, or null once it leaves. */
  onHover: (cell: number | null) => void
  onOpen: () => void
}

const SCALE_BAR_M = 2_000

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.trim().slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** A map of one number across the ground, with the site and the best places marked. */
export function NearbyCanvas({ data, metric, limitDeg, selected, current, spots, label, onSelect, onHover, onOpen }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { meta, slope, values } = data
  const { size } = meta

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const draw = () => {
      const style = getComputedStyle(element)
      const low = hexToRgb(style.getPropertyValue('--cell-low'))
      const high = hexToRgb(style.getPropertyValue('--cell-high'))
      const empty = hexToRgb(style.getPropertyValue('--cell-empty'))
      const worstGap = largestGapH(values)
      const image = context.createImageData(size, size)
      for (let cell = 0; cell < size * size; cell += 1) {
        const allowed = withinSlope(slope, meta.slope_quant_deg, cell, limitDeg)
        const share = goodnessPct(metric, cellValue(values, metric, cell), worstGap) / 100
        for (let channel = 0; channel < 3; channel += 1) {
          image.data[cell * 4 + channel] = allowed
            ? low[channel] + (high[channel] - low[channel]) * share
            : empty[channel]
        }
        image.data[cell * 4 + 3] = 255
      }
      context.putImageData(image, 0, 0)
    }
    draw()
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', draw)
    return () => scheme.removeEventListener('change', draw)
  }, [values, slope, meta.slope_quant_deg, metric, limitDeg, size])

  const toCell = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const col = Math.floor(((event.clientX - box.left) / box.width) * size)
    const row = Math.floor(((event.clientY - box.top) / box.height) * size)
    return Math.max(0, Math.min(size - 1, row)) * size + Math.max(0, Math.min(size - 1, col))
  }
  const position = (cell: number) => ({ x: (cell % size) + 0.5, y: Math.floor(cell / size) + 0.5 })
  const site = position(centerCell(meta))
  const chosen = position(selected)
  const here = current === null ? null : position(current)
  const barCells = SCALE_BAR_M / meta.step_m

  return (
    <div className="nearby-canvas">
      <canvas
        ref={canvas}
        width={size}
        height={size}
        tabIndex={0}
        role="img"
        aria-label={`${label}. Arrow keys move the selection; Enter opens it.`}
        onPointerDown={(event) => onSelect(toCell(event))}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse') onHover(toCell(event))
        }}
        onPointerLeave={() => onHover(null)}
        onKeyDown={(event) => {
          const steps: Record<string, number> = {
            ArrowLeft: selected % size > 0 ? -1 : 0,
            ArrowRight: selected % size < size - 1 ? 1 : 0,
            ArrowUp: selected >= size ? -size : 0,
            ArrowDown: selected < size * (size - 1) ? size : 0,
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onOpen()
          } else if (event.key in steps) {
            event.preventDefault()
            onSelect(selected + steps[event.key])
          }
        }}
      />
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <rect
          className="nearby-selected"
          x={chosen.x - 1.5}
          y={chosen.y - 1.5}
          width={3}
          height={3}
        />
        {spots.map((cell, i) => {
          const { x, y } = position(cell)
          return (
            <g key={cell} className="nearby-spot">
              <circle cx={x} cy={y} r={2.6} />
              <text x={x} y={y + 1.3}>
                {i + 1}
              </text>
            </g>
          )
        })}
        {here && <circle className="nearby-here" cx={here.x} cy={here.y} r={1.8} />}
        <circle className="nearby-site" cx={site.x} cy={site.y} r={1.8} />
        <g className="nearby-scale">
          <line x1={size - barCells - 3} x2={size - 3} y1={size - 3} y2={size - 3} />
          <text x={size - 3 - barCells / 2} y={size - 5}>
            {SCALE_BAR_M / 1000} km
          </text>
        </g>
      </svg>
    </div>
  )
}
