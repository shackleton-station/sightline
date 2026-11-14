import { useEffect, useMemo, useState } from 'react'
import type { NearbyMeta, SiteInfo } from '../data/contract'
import { loadNearby, type NearbyData } from '../data/loadNearby'
import type { Mode } from '../lib/mode'
import { monthLabel } from '../lib/months'
import {
  bestSpots,
  cellAt,
  cellDistanceM,
  cellLatLon,
  cellValue,
  centerCell,
  type NearbyMetric,
  shareWithinSlope,
  slopeDeg,
  valueRange,
  withinSlope,
} from '../lib/nearby'
import { NearbyCanvas } from './NearbyCanvas'

interface Props {
  anchor: SiteInfo
  /** The place on show: the anchor, or a custom point on its map. */
  point: SiteInfo
  month: string
  mode: Mode
  onOpen: (lat: number, lon: number) => void
}

const METRICS: { metric: NearbyMetric; label: string; unit: string }[] = [
  { metric: 'both', label: 'Sun and Earth', unit: 'Sun and Earth both up' },
  { metric: 'sun', label: 'Sun', unit: 'Sun up' },
  { metric: 'earth', label: 'Earth', unit: 'Earth in view' },
  { metric: 'sunGap', label: 'Longest without Sun', unit: 'Longest without Sun' },
]
const SLOPE_LIMITS: (number | null)[] = [null, 5, 10, 15]
const SPOTS = 5
/** An example for planners, on screen as one of the choices. Learn starts by showing all the ground. */
const PLAN_SLOPE_LIMIT = 10

function valueText(metric: NearbyMetric, value: number): string {
  return metric === 'sunGap' ? `${value} h` : `${value}%`
}

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`

function checkSentence({ uniform, well_lit: wellLit }: NearbyMeta['check']): string {
  return (
    `Checked against NASA's 18.6-year maps at ${uniform.sun.n + wellLit.sun.n} spots on this ground: Sun differs ` +
    `by ${uniform.sun.rmse} points typically (${wellLit.sun.rmse} on well-lit ground), and Earth by ` +
    `${uniform.earth.rmse}. The spots we rate highest for Sun read ${signed(uniform.sun.top_bias)} points against ` +
    `NASA's (${signed(wellLit.sun.top_bias)} on well-lit ground) and fall near its ` +
    `${uniform.sun.top_map_percentile}th percentile, so they're good places to look, not proven winners. ` +
    `NASA's maps are long-run averages, so single months have no such check.`
  )
}

/** How Sun, Earth and slope change across the ground around a site, and better places to look. */
export function NearbyMap({ anchor, point, month, mode, onOpen }: Props) {
  const plan = mode === 'plan'
  const [data, setData] = useState<NearbyData | null>(null)
  const [failed, setFailed] = useState(false)
  const [metric, setMetric] = useState<NearbyMetric>('both')
  const [limitDeg, setLimitDeg] = useState<number | null>(plan ? PLAN_SLOPE_LIMIT : null)
  const [selection, setSelection] = useState<{ siteId: string; cell: number } | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    let current = true
    setFailed(false)
    loadNearby(anchor.id, month)
      .then((loaded) => {
        if (current) setData(loaded)
      })
      .catch((reason: unknown) => {
        console.error(reason)
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [anchor.id, month])

  const shown = data?.siteId === anchor.id && data.month === month ? data : null
  const spots = useMemo(
    () => (shown ? bestSpots(shown.meta, shown.values, metric, shown.slope, limitDeg, SPOTS) : []),
    [shown, metric, limitDeg],
  )

  if (failed) return <p className="pending">This map could not be loaded.</p>
  if (!shown) return <p className="note">Loading the ground around {anchor.name}…</p>

  const { meta, values, slope } = shown
  const quant = meta.slope_quant_deg
  const center = centerCell(meta)
  const pointCell = point.id === anchor.id ? null : cellAt(meta, point.lat, point.lon)
  const selected = selection?.siteId === anchor.id ? selection.cell : (pointCell ?? center)
  const choice = METRICS.find((entry) => entry.metric === metric) ?? METRICS[0]
  const range = valueRange(values, metric, slope, quant, limitDeg)
  const describe = (cell: number) => cellValue(values, metric, cell)
  const place = (cell: number) => {
    const distance = cellDistanceM(meta, cell)
    return distance < 1 ? anchor.name : `${(distance / 1000).toFixed(1)} km from ${anchor.name}`
  }
  const shownCell = hovered ?? selected
  const readout =
    `${place(shownCell)}: ${choice.unit} ${valueText(metric, describe(shownCell))}, ` +
    `slope ${slopeDeg(slope, quant, shownCell).toFixed(1)}°`
  const steep = !withinSlope(slope, quant, shownCell, limitDeg)
  const openCell = (cell: number) => {
    if (cell === center) {
      onOpen(anchor.lat, anchor.lon)
      return
    }
    const { lat, lon } = cellLatLon(meta, cell)
    onOpen(lat, lon)
  }
  const flatShare = shareWithinSlope(slope, quant, limitDeg ?? PLAN_SLOPE_LIMIT)
  const label = `${choice.unit}, ${monthLabel(month)}, across the ${meta.half_width_m / 1000} km around ${anchor.name}`

  return (
    <div className="nearby">
      <p>
        {choice.unit}, {monthLabel(month)}: {valueText(metric, describe(center))} at {anchor.name}
        {range && (
          <>
            , and {valueText(metric, range.low)} to {valueText(metric, range.high)} on{' '}
            {limitDeg === null ? 'the ground' : `ground under ${limitDeg}°`} within {meta.half_width_m / 1000} km
          </>
        )}
        . Only {Math.round(flatShare)}% of this ground is gentler than {limitDeg ?? PLAN_SLOPE_LIMIT}°.
      </p>
      <div className="grid-controls">
        <div className="choice" role="group" aria-label="What to show">
          {METRICS.map((entry) => (
            <button
              key={entry.metric}
              type="button"
              aria-pressed={entry.metric === metric}
              onClick={() => setMetric(entry.metric)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="choice" role="group" aria-label="Hide ground steeper than">
          {SLOPE_LIMITS.map((limit) => (
            <button
              key={limit ?? 'all'}
              type="button"
              aria-pressed={limit === limitDeg}
              onClick={() => setLimitDeg(limit)}
            >
              {limit === null ? 'All ground' : `Under ${limit}°`}
            </button>
          ))}
        </div>
      </div>
      <div className="nearby-layout">
        <div>
          <NearbyCanvas
            data={shown}
            metric={metric}
            limitDeg={limitDeg}
            selected={selected}
            current={pointCell}
            spots={spots}
            label={label}
            onSelect={(cell) => setSelection({ siteId: anchor.id, cell })}
            onHover={setHovered}
            onOpen={() => openCell(selected)}
          />
          <p className="grid-key note" aria-hidden="true">
            {metric === 'sunGap' ? 'Longest' : 'None'} <span className="cell-scale" />{' '}
            {metric === 'sunGap' ? 'No gap' : 'All of the month'}
            {limitDeg !== null && (
              <>
                {' '}
                <span className="cell-swatch empty" /> Steeper than {limitDeg}°
              </>
            )}
          </p>
          <p className="note">
            White circle: {anchor.name}. Numbers: the list beside this map. Up is toward 0° longitude. Choose a square
            to read it.
          </p>
        </div>
        <div className="nearby-side">
          <p role="status">
            <strong>{readout}.</strong>
            {steep && ' Steeper than your limit.'}
          </p>
          {selected !== pointCell && selected !== center && (
            <button type="button" className="plain-button" onClick={() => openCell(selected)}>
              Open the square you chose
            </button>
          )}
          {selected === center && point.id !== anchor.id && (
            <button type="button" className="plain-button" onClick={() => onOpen(anchor.lat, anchor.lon)}>
              Open {anchor.name}
            </button>
          )}
          <h3>Better than {anchor.name} on this measure</h3>
          {spots.length === 0 ? (
            <p className="note">
              Nowhere on {limitDeg === null ? 'this ground' : `ground under ${limitDeg}°`} beats the site this month.
            </p>
          ) : (
            <ol className="nearby-spots">
              {spots.map((cell) => (
                <li key={cell}>
                  <button type="button" className="plain-button" onClick={() => openCell(cell)}>
                    {(cellDistanceM(meta, cell) / 1000).toFixed(1)} km away:{' '}
                    {valueText(metric, describe(cell))}, slope {slopeDeg(slope, quant, cell).toFixed(1)}°
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <p className="note">
        {plan
          ? checkSentence(meta.check)
          : 'Good for finding places worth a closer look, not for proving one spot is the best.'}{' '}
        Each square is one point every {meta.step_m} m, {meta.obs_height_m} m above the ground, with slope measured
        over {meta.slope_baseline_m} m, so rocks don't show. Choosing a spot works out its exact dates and limits.
      </p>
    </div>
  )
}
