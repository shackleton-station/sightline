import { useMemo, useState } from 'react'
import type { FlaggedSite } from '../data/useAllFlags'
import { CSA_ROVER, ROVER_PRESET, roverMissionDays } from '../lib/csaRover'
import { type GridCell, type MonthSpan, shadePct } from '../lib/grid'
import { monthLabel, monthName } from '../lib/months'
import { clockTime, stateRuns } from '../lib/sightline'
import { fitProblems, MAX_SCENARIOS, presetOf, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { cellDetail, cellWords, FIND_MEASURES, type FindMeasure, findRow, fitHours, runningTotals } from './plannerFit'
import { BAND } from './states'

interface Props {
  start: string
  /** Every listed site with its hourly flags, at the mission's heights. */
  flagged: FlaggedSite[]
  /** The months of the data on hand. */
  spans: MonthSpan[]
  /** The year the grid opens on: the landing's on show. */
  year: number
  mission: SightlineMission
  onMission: (mission: SightlineMission) => void
  /** How many scenarios there are, for the next free letter. */
  count: number
  /** Add a scenario and show it. Never leaves the page. */
  onAdd: (scenario: SightlineScenario) => void
}

/** The groups in the order the grid lists them; a group not named here follows, in the data's order. */
const GROUP_ORDER = ['South pole ridges', 'CLPS', 'Apollo', 'Other countries']
/** Above this shade a cell's text turns dark to keep its contrast. */
const DARK_INK_FROM_PCT = 72
/** Each measure's colour, as "r g b": the same gold, blue and green as the bands. */
const TINT: Record<FindMeasure, string> = { fit: '87 192 138', sun: '233 180 76', earth: '91 155 234', both: '87 192 138' }

/** The sites in their groups, each group in the data's own order. */
function grouped(flagged: FlaggedSite[]): { group: string; rows: FlaggedSite[] }[] {
  const names = [...new Set(flagged.map(({ site }) => site.group))]
  names.sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || GROUP_ORDER.length + 1) - (GROUP_ORDER.indexOf(b) + 1 || GROUP_ORDER.length + 1))
  return names.map((group) => ({ group, rows: flagged.filter(({ site }) => site.group === group) }))
}

/**
 * Find: "where and when could I land?" Every listed site by month for a year. A cell shows, by
 * default, on how many days of that month a landing fits the mission on the left: the verdict's own
 * answer, counted for every hour (`plannerFit.ts`). A cell opens its month under the grid, where a
 * fitting landing can be added as the next scenario.
 */
export function PlannerFind({ start, flagged, spans, year, mission, onMission, count, onAdd }: Props) {
  const [measure, setMeasure] = useState<FindMeasure>('fit')
  const years = useMemo(() => [...new Set(spans.map((span) => Number(span.month.slice(0, 4))))], [spans])
  const [picked, setPicked] = useState(year)
  const gridYear = years.includes(picked) ? picked : year
  const shown = useMemo(() => spans.filter((span) => span.month.startsWith(`${gridYear}-`)), [spans, gridYear])
  // Every site's fitting hours, worked out again whenever the mission or the heights change.
  const fits = useMemo(() => {
    const began = performance.now()
    const bySite = new Map(flagged.map(({ site, flags }) => [site.id, fitHours(flags, mission, site.slope?.deg ?? null)]))
    return { bySite, ms: performance.now() - began }
  }, [flagged, mission])
  const groups = useMemo(() => grouped(flagged), [flagged])
  const rows = useMemo(
    () => new Map(flagged.map(({ site, flags }) => [site.id, findRow(measure, flags, fits.bySite.get(site.id) as Uint8Array, shown)])),
    [flagged, fits, measure, shown],
  )
  const largest = useMemo(() => Math.max(0, ...[...rows.values()].flat().map((cell) => cell.share)), [rows])

  // The cell opened under the grid, and which of its two named landings "Add" takes.
  const [open, setOpen] = useState<{ site: string; month: string } | null>(null)
  const [take, setTake] = useState<'first' | 'sunniest'>('first')
  const [added, setAdded] = useState<string | null>(null)
  const openSite = open ? flagged.find(({ site }) => site.id === open.site) : undefined
  const openSpan = open ? shown.find((span) => span.month === open.month) : undefined
  const detail = useMemo(() => {
    if (!openSite || !openSpan) return null
    return cellDetail(fits.bySite.get(openSite.site.id) as Uint8Array, runningTotals(openSite.flags.sun), openSpan, mission.requirements.missionDays)
  }, [openSite, openSpan, fits, mission.requirements.missionDays])

  const room = count < MAX_SCENARIOS
  const letter = SCENARIO_LETTERS[count]
  const info = FIND_MEASURES.find((one) => one.id === measure) as (typeof FIND_MEASURES)[number]
  const example = presetOf(mission)?.id === ROVER_PRESET.id
  const [exampleNote, setExampleNote] = useState(false)
  const days = roverMissionDays()

  const cellName = (siteName: string, cell: GridCell) => {
    const when = monthLabel(cell.month)
    if (measure === 'fit') return cell.days === 0 ? `${siteName}, ${when}: no landing fits the mission.` : `${siteName}, ${when}: a landing fits on ${cell.days} ${cell.days === 1 ? 'day' : 'days'}.`
    return `${siteName}, ${when}: ${info.label} in view ${cell.text}% of the month.`
  }

  return (
    <div className="pl-find" role="tabpanel" aria-label="Find" data-fit-ms={fits.ms.toFixed(1)}>
      <div className="pl-find-bar">
        <h3>Where and when could I land?</h3>
        <label className="pl-find-year">
          Year{' '}
          <select aria-label="Year" value={gridYear} onChange={(event) => setPicked(Number(event.target.value))}>
            {years.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="sl-small pl-example"
          aria-pressed={example && exampleNote}
          title="Set the mission to the Long stay example, to see where and when such a rover could land"
          onClick={() => {
            onMission(ROVER_PRESET.mission)
            setExampleNote(true)
          }}
        >
          Example: Canada’s utility rover
        </button>
      </div>
      {example && exampleNote && (
        <p className="pl-rover">
          From the Canadian Space Agency, in its own words: status “{CSA_ROVER.status}”, launch “{CSA_ROVER.launch}”, and it is to “{CSA_ROVER.survive}”. The agency has published no landing site. The mission on the left is now
          Long stay, an example and not the rover’s own figures: {days.stay} days, at most {days.dark} days without Sun{days.silent === null ? '' : ` and ${days.silent} days without Earth`}. The grid shows where and when such a mission could land.{' '}
          <a href={CSA_ROVER.url} target="_blank" rel="noreferrer">
            Canadian Space Agency: {CSA_ROVER.pageTitle}
          </a>{' '}
          (page dated {CSA_ROVER.modified}).
        </p>
      )}
      <div className="pl-measures" role="group" aria-label="What a cell shows">
        {FIND_MEASURES.map((one) => (
          <button key={one.id} type="button" className="sl-small" aria-pressed={one.id === measure} title={one.title} onClick={() => setMeasure(one.id)}>
            {one.label}
          </button>
        ))}
      </div>
      <p className="pl-find-legend">
        {info.legend}: <span>{measure === 'fit' ? 'none' : '0'}</span>
        <i style={{ background: `linear-gradient(90deg, rgb(${TINT[measure]} / 8%), rgb(${TINT[measure]} / 85%))` }} aria-hidden="true" />
        <span>{measure === 'fit' ? 'most' : '100'}</span>
      </p>
      <div className="sl-full-scroll">
        <table className="pl-months" data-measure={measure} data-year={gridYear}>
          <thead>
            <tr>
              <td />
              {shown.map((span) => (
                <th key={span.month} scope="col">
                  {monthName(span.month)}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(({ group, rows: sites }) => (
            <tbody key={group}>
              <tr className="pl-group-row">
                <th scope="colgroup" colSpan={shown.length + 1}>
                  {group}
                </th>
              </tr>
              {sites.map(({ site }) => (
                <tr key={site.id}>
                  <th scope="row">{site.name}</th>
                  {(rows.get(site.id) ?? []).map((cell) => {
                    const shade = shadePct(cell.share, largest, measure === 'fit' ? 'landing' : measure)
                    const on = open?.site === site.id && open.month === cell.month
                    return (
                      <td key={cell.month}>
                        <button
                          type="button"
                          className={shade > DARK_INK_FROM_PCT ? 'is-dark-ink' : undefined}
                          style={{ background: `rgb(${TINT[measure]} / ${(0.85 * shade).toFixed(0)}%)` }}
                          aria-pressed={on}
                          data-site={site.id}
                          data-month={cell.month}
                          data-days={measure === 'fit' ? cell.days : undefined}
                          aria-label={cellName(site.name, cell)}
                          onClick={() => {
                            setOpen(on ? null : { site: site.id, month: cell.month })
                            setTake('first')
                            setAdded(null)
                          }}
                        >
                          {cellWords(measure, cell)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {openSite && openSpan && detail && (
        <section className="pl-strip" aria-label={`${openSite.site.name}, ${monthLabel(openSpan.month)}`} data-site={openSite.site.id} data-month={openSpan.month}>
          <header>
            <h4>
              {openSite.site.name} · {monthLabel(openSpan.month)}
            </h4>
            <button type="button" className="sl-small" onClick={() => setOpen(null)}>
              Close
            </button>
          </header>
          <MonthBands site={openSite} span={openSpan} runs={detail.runs} />
          {detail.first === null ? (
            <p>
              No landing in {monthLabel(openSpan.month)} fits the mission. On the 1st at 00:00 UTC: {fitProblems(openSite.flags, openSpan.from, mission, openSite.site.slope?.deg ?? null).join(' ')}
            </p>
          ) : (
            <div className="pl-landings" role="group" aria-label="Which landing to add">
              <button type="button" className="sl-small" aria-pressed={take === 'first'} onClick={() => setTake('first')}>
                First that fits: {clockTime(start, detail.first)}
              </button>
              {detail.sunniest && (
                <button type="button" className="sl-small" aria-pressed={take === 'sunniest'} title="Of the landings that fit, the one whose mission has the most hours of Sun" onClick={() => setTake('sunniest')}>
                  Most Sun: {clockTime(start, detail.sunniest.landing)}, {detail.sunniest.sunPct.toFixed(0)}% of the mission sunlit
                </button>
              )}
            </div>
          )}
          <p className="pl-add">
            {added ? (
              <span role="status">Added as {added}.</span>
            ) : !room ? (
              'Four scenarios at most: remove one to add another.'
            ) : (
              <button
                type="button"
                className="sl-small is-main"
                data-landing={detail.first === null ? openSpan.from : take === 'sunniest' && detail.sunniest ? detail.sunniest.landing : detail.first}
                onClick={() => {
                  const landing = detail.first === null ? openSpan.from : take === 'sunniest' && detail.sunniest ? detail.sunniest.landing : detail.first
                  onAdd({ site: openSite.site.id, landing })
                  setAdded(letter)
                }}
              >
                {detail.first === null ? `Add the 1st as ${letter}` : `Add as ${letter}`}
              </button>
            )}
          </p>
        </section>
      )}
    </div>
  )
}

/** One month at a site: where a landing fits, over the Sun and Earth bands, on an axis of days. */
function MonthBands({ site, span, runs }: { site: FlaggedSite; span: MonthSpan; runs: { from: number; to: number }[] }) {
  const hours = span.to - span.from
  const days = hours / 24
  const marks = [1, 5, 10, 15, 20, 25].filter((day) => day <= days)
  return (
    <div className="pl-bands">
      <div className="pl-band">
        <span>Fits</span>
        <svg viewBox={`0 0 ${hours} 12`} preserveAspectRatio="none" role="img" aria-label={`A landing fits in ${runs.length} ${runs.length === 1 ? 'stretch' : 'stretches'} of the month`}>
          {runs.map((run) => (
            <rect key={run.from} className="pl-fit" x={run.from} y={3} width={run.to - run.from} height={6} />
          ))}
        </svg>
      </div>
      <div className="pl-band">
        <span>Sun, Earth</span>
        <svg viewBox={`0 0 ${hours} 12`} preserveAspectRatio="none" aria-hidden="true">
          {stateRuns(site.flags, span.from, span.to).map((run) => (
            <rect key={run.from} className={`sl-run is-${run.state}`} x={run.from} y={BAND[run.state].y} width={run.to - run.from} height={BAND[run.state].height} />
          ))}
        </svg>
      </div>
      <div className="pl-band pl-day-marks" aria-hidden="true">
        <span />
        <div>
          {marks.map((day) => (
            <i key={day} style={{ left: `${(100 * (day - 1)) / days}%` }}>
              {day}
            </i>
          ))}
        </div>
      </div>
      <p className="sl-legend">
        <i className="pl-key-fit" /> A landing fits <i className="sl-key is-sun" /> Sun <i className="sl-key is-earth" /> Earth <i className="sl-key is-both" /> Both <i className="sl-key is-none" /> Neither
      </p>
    </div>
  )
}
