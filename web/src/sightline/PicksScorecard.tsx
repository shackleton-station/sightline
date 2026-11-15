import type { TrackPoint } from '../data/contract'
import type { ScenarioMeasure, SightlineMission } from '../lib/sightlineMission'

interface Row {
  letter: string
  name: string
  measure: ScenarioMeasure | null
  track: TrackPoint[] | null | undefined
}

interface Props {
  rows: Row[]
  mission: SightlineMission
  active: number
  onSelect: (index: number) => void
}

type Tone = 'good' | 'close' | 'over' | 'none'

interface Cell {
  text: string
  tone: Tone
  /** 0 to 1, how far along the bar under the number fills. */
  fill: number
  /** The value the column's best is chosen by: higher is better. Null when unknown. */
  rank: number | null
}

function compact(hours: number): string {
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

/** A gap against its limit: within it, close to it (three quarters of the way or more), or past it. */
function gapCell(hours: number | null, limit: number): Cell {
  if (hours === null) return { text: '–', tone: 'none', fill: 0, rank: null }
  const tone: Tone = hours > limit ? 'over' : hours >= 0.75 * limit && hours > 0 ? 'close' : 'good'
  return { text: compact(hours), tone, fill: Math.min(1, limit > 0 ? hours / limit : 1), rank: -hours }
}

/** A share of the mission, shaded by how much of it there is. */
function shareCell(pct: number | null): Cell {
  if (pct === null) return { text: '–', tone: 'none', fill: 0, rank: null }
  return { text: `${Math.round(pct)}%`, tone: pct >= 75 ? 'good' : pct >= 40 ? 'close' : 'over', fill: pct / 100, rank: pct }
}

/** The columns: one square for each thing the challenge asks a planner to weigh. */
const COLUMNS: { key: string; label: string; title: string; cell: (row: Row, mission: SightlineMission) => Cell }[] = [
  {
    key: 'fits',
    label: 'Fits',
    title: 'Whether a landing then gets through the whole mission within your limits',
    cell: ({ measure }) => (measure === null ? { text: '…', tone: 'none', fill: 0, rank: null } : measure.problems.length === 0 ? { text: '✓', tone: 'good', fill: 1, rank: 1 } : { text: '✗', tone: 'over', fill: 1, rank: 0 }),
  },
  { key: 'sun', label: 'Sunlit', title: 'Share of the mission with the Sun in view: solar power', cell: ({ measure }) => shareCell(measure?.sunPct ?? null) },
  { key: 'dark', label: 'Dark', title: 'Longest time without the Sun, against your limit', cell: ({ measure }, mission) => gapCell(measure?.sunGapH ?? null, mission.requirements.maxSunGapH) },
  { key: 'earth', label: 'Earth', title: 'Share of the mission with Earth in view: a direct radio link', cell: ({ measure }) => shareCell(measure?.earthPct ?? null) },
  { key: 'silence', label: 'Silence', title: 'Longest time without Earth, against your limit', cell: ({ measure }, mission) => gapCell(measure?.earthGapH ?? null, mission.requirements.maxEarthGapH) },
  {
    key: 'height',
    label: 'Sun low',
    title: "The Sun's lowest height above a level horizon while it is in view during the mission: a panel makes least then",
    cell: ({ track }) => {
      const up = (track ?? []).filter((point) => point.sun_up).map((point) => point.sun_el)
      if (!track || up.length === 0) return { text: track === undefined ? '…' : '–', tone: 'none', fill: 0, rank: null }
      const low = Math.min(...up)
      return { text: `${low.toFixed(1)}°`, tone: low >= 1 ? 'good' : low >= 0 ? 'close' : 'over', fill: Math.max(0, Math.min(1, (low + 2) / 6)), rank: low }
    },
  },
  {
    key: 'slope',
    label: 'Slope',
    title: 'Ground slope at the site, against your steepest-ground limit',
    cell: ({ measure }, mission) => {
      const slope = measure?.slopeDeg ?? null
      if (slope === null) return { text: '–', tone: 'none', fill: 0, rank: null }
      const limit = mission.maxSlopeDeg
      return { text: `${slope.toFixed(1)}°`, tone: slope > limit ? 'over' : slope >= 0.75 * limit ? 'close' : 'good', fill: Math.min(1, slope / limit), rank: -slope }
    },
  },
]

/**
 * Your picks at a glance: one row each, one square for each thing to weigh (fits, sunlit, dark,
 * Earth, silence, the Sun's lowest height, slope), coloured against your own limits: green within,
 * amber close, red past. The best in each column is starred. A row opens that pick.
 */
export function PicksScorecard({ rows, mission, active, onSelect }: Props) {
  const cells = rows.map((row) => COLUMNS.map((column) => column.cell(row, mission)))
  const best = COLUMNS.map((_, c) => {
    const ranks = cells.map((row) => row[c].rank).filter((rank): rank is number => rank !== null)
    // A star only marks a real winner: none when every pick scores the same.
    return ranks.length > 1 && Math.max(...ranks) !== Math.min(...ranks) ? Math.max(...ranks) : null
  })
  return (
    <section className="np-score" aria-labelledby="np-score-title">
      <h3 id="np-score-title">At a glance</h3>
      <div className="np-score-grid" role="table" style={{ gridTemplateColumns: `minmax(7rem, 1.4fr) repeat(${COLUMNS.length}, minmax(0, 1fr))` }}>
        <div role="row" className="np-score-row is-head">
          <span role="columnheader" />
          {COLUMNS.map((column) => (
            <span key={column.key} role="columnheader" title={column.title}>
              {column.label}
            </span>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={row.letter} role="row" className={`np-score-row ${r === active ? 'is-on-show' : ''}`}>
            <button type="button" role="rowheader" className="np-score-name" title={r === active ? 'On show' : 'Show this pick'} onClick={() => onSelect(r)}>
              <span className="pl-sunrow-letter">{row.letter}</span> {row.name}
            </button>
            {cells[r].map((cell, c) => (
              <span key={COLUMNS[c].key} role="cell" className={`np-square is-${cell.tone}`} title={COLUMNS[c].title}>
                <b>
                  {cell.text}
                  {best[c] !== null && cell.rank === best[c] && <span className="np-star"> ★</span>}
                </b>
                <i style={{ width: `${Math.round(cell.fill * 100)}%` }} />
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="sl-legend">
        <i className="np-key is-good" /> within your limits <i className="np-key is-close" /> close to a limit <i className="np-key is-over" /> past it. ★ best of your picks. Hover a square for what it measures.
      </p>
    </section>
  )
}
