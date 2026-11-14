import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { loadEarthSun } from '../data/loadSite'
import { earthPath, EVERYDAY_LAT_DEG } from '../lib/earthSun'
import type { SiteFlags } from '../lib/flags'
import { locateHour } from '../lib/mission'
import type { RiverSegment, RiverState } from '../lib/river'
import { ABOVE_SKYLINE_MEANS, bandWords, clockTime, DEFAULT_SPEED, degWords, type RiverZoom, riverTicks, riverWindow, runAt, SPEEDS, stateRuns, TIME_KEYS_MEAN } from '../lib/sightline'
import type { RowLabel } from '../lib/sightlineMission'
import { type Clock, useFitLevel } from './hooks'
import { BAND, STATE_CHIP } from './states'

export interface RiverRow {
  key: string
  /** The scenario's letter, "A". */
  letter: string
  /** What the row shows beside its letter: only what differs between the rows (lib/sightlineMission.ts, rowLabels). */
  label: RowLabel
  /** The whole of it, "Connecting Ridge · 6 May 2027 · 13:00 UTC", for the tooltip and the accessible name. */
  full: string
  /** The site's hourly flags; null while they load (a custom point is worked out in the browser). */
  flags: SiteFlags | null
  /** The landing, in clock hours. */
  landing: number
  active: boolean
}

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  clock: Clock
  /** The whole hour on the time bar. */
  hour: number
  /** That moment at the scenario on show: what is up, and how far the Sun's and Earth's centres are above the ridge. Null parts are still loading. */
  moment: { state: RiverState | null; /** The chip's words: what is up, saying so when only part of Earth shows. */ words: string | null; sunAboveDeg: number | null; earthAboveDeg: number | null }
  rows: RiverRow[]
  /** How long the mission lasts from its landing, in hours. */
  missionHours: number
  folded: boolean
  onFold: (folded: boolean) => void
  onSelect: (key: string) => void
  /** The skyline strip above this bar ("What the lander sees"): whether it is open, and its door, which is this bar's readout of the Sun's and Earth's heights. */
  sky: { open: boolean; onToggle: () => void }
}

const ZOOMS: { id: RiverZoom; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

/**
 * An ordinary day on Earth for the hours on show: when the Sun is up at 40°N, from the pipeline's
 * record of where on Earth the Sun is overhead. Null until it loads, or when not asked for.
 */
function useEarthDay(start: string, from: number, to: number, wanted: boolean): boolean[] | null {
  const [loaded, setLoaded] = useState<{ from: number; to: number; up: boolean[] } | null>(null)
  useEffect(() => {
    if (!wanted) return
    let current = true
    const first = locateHour(start, from)
    const last = locateHour(start, to - 1)
    const months = first.month === last.month ? [first.month] : [first.month, last.month]
    Promise.all(months.map((month) => loadEarthSun(month)))
      .then((files) => {
        if (!current) return
        const up = files.flatMap((file) => earthPath(file, EVERYDAY_LAT_DEG).up).slice(first.index, first.index + (to - from))
        setLoaded({ from, to, up })
      })
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [start, from, to, wanted])
  return wanted && loaded && loaded.from === from && loaded.to === to ? loaded.up : null
}

/**
 * The time river: one row per scenario on one time axis, coloured by what is up at its site, with a
 * marker for the landing and the mission's length, and one playhead through them all. Drag anywhere
 * on it to move time.
 */
export function River({ start, hours, clock, hour, moment, rows, missionHours, folded, onFold, onSelect, sky }: Props) {
  const [zoom, setZoom] = useState<RiverZoom>('month')
  const [earthRow, setEarthRow] = useState(false)
  const { from, to } = riverWindow(start, hour, zoom, hours)
  const count = to - from
  const ticks = useMemo(() => riverTicks(start, from, to, zoom), [start, from, to, zoom])
  // At a year's width an Earth day is narrower than a pixel, so the row is offered up to a month.
  const earthDay = useEarthDay(start, from, to, earthRow && zoom !== 'year' && !folded)
  const at = (sample: number) => `${(100 * sample) / count}%`
  // The label column is as wide as its longest label needs, up to a limit (set in the styles); only then is a site shortened.
  // (On a phone a row with a date leaves its site out, so there the shorter of the two sets the width.)
  const wide = (row: RiverRow, site: boolean) => `${row.letter}${row.label.date ? ` · ${row.label.date}` : ''}${site && row.label.site ? ` · ${row.label.site}` : ''}`.length
  const longest = Math.max(...rows.map((row) => wide(row, true)))
  const longestDate = Math.max(...rows.map((row) => wide(row, row.label.date === null)))

  // The header is one row. 6 is everything in it, and each level down moves one thing to "More", or
  // drops it: "A day on Earth", the speed, the legend, the heights (dropped), the zoom, and last the
  // date's "UTC" and the chip's spare room. Nothing is shown twice: what is in the row is not in "More".
  const head = useFitLevel<HTMLDivElement>(6)
  const level = head.level
  const inHead = { earthDay: level >= 6, speed: level >= 5, legend: level >= 4, heights: level >= 3, zooms: level >= 2, roomy: level >= 1 }
  const [more, setMore] = useState(false)
  // On a phone the styles leave the heights out of the row whatever its level, so there the skyline's door is in "More".
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 760px)')
    const follow = () => setPhone(narrow.matches)
    narrow.addEventListener('change', follow)
    return () => narrow.removeEventListener('change', follow)
  }, [])
  const doorInRow = inHead.heights && !phone
  // One level down the heights no longer fit the row, but a short door does ("Skyline"), so on a small laptop it is still in plain sight.
  const shortDoor = !doorInRow && inHead.zooms && !phone
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!more) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target instanceof Element && (menu.current?.contains(event.target) || event.target.closest('.sl-more')))) setMore(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [more])
  const zooms = (
    <span className="sl-zooms" role="group" aria-label="How much time the river shows">
      {ZOOMS.map((option) => (
        <button key={option.id} type="button" aria-pressed={zoom === option.id} onClick={() => setZoom(option.id)}>
          {option.label}
        </button>
      ))}
    </span>
  )
  const legend = (
    <span className="sl-legend">
      <i className="sl-key is-sun" /> Sun <i className="sl-key is-earth" /> Earth <i className="sl-key is-both" /> Both <i className="sl-key is-none" /> Neither
    </span>
  )
  // At a year's width an Earth day is narrower than a pixel, so the row is offered up to a month, and only while the rows are open.
  const earthDayBox = zoom !== 'year' && !folded && (
    <label className="sl-check">
      <input type="checkbox" checked={earthRow} onChange={(event) => setEarthRow(event.target.checked)} /> A day on Earth
    </label>
  )
  // Where the row has no room for the heights, the skyline's door is in "More" instead, so it is always one press away.
  const menuHolds = (!doorInRow && !shortDoor) || !inHead.speed || (!folded && (!inHead.zooms || !inHead.legend)) || (!inHead.earthDay && earthDayBox !== false)
  const speed = (
    <select aria-label="Speed" value={SPEEDS.some((one) => one.hoursPerSecond === clock.hoursPerSecond) ? clock.hoursPerSecond : DEFAULT_SPEED} onChange={(event) => clock.setSpeed(Number(event.target.value))}>
      {SPEEDS.map((one) => (
        <option key={one.hoursPerSecond} value={one.hoursPerSecond} title={one.label}>
          {one.label.replace(' a second', '/s')}
        </option>
      ))}
    </select>
  )

  const dragging = useRef(false)
  // The band under the pointer, or, with the keyboard on the time bar, the band the bar is in on the
  // scenario on show: which row, and the whole stretch it belongs to. Its line shows over its own row.
  const [pointed, setPointed] = useState<({ row: number } & RiverSegment) | null>(null)
  const [focused, setFocused] = useState(false)
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const tracks = [...(event.currentTarget.parentElement?.querySelectorAll('.sl-row .sl-track') ?? [])].slice(0, rows.length)
    const row = tracks.findIndex((track) => event.clientY >= track.getBoundingClientRect().top - 3 && event.clientY <= track.getBoundingClientRect().bottom + 3)
    const flags = row >= 0 ? rows[row].flags : null
    if (!flags) return setPointed(null)
    const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    const run = runAt(flags, Math.min(from + Math.floor(fraction * count), to - 1))
    // Moving along the same band changes nothing: the line is drawn again only for another band.
    setPointed((before) => (before && before.row === row && before.from === run.from ? before : { row, ...run }))
  }
  const onShow = rows.findIndex((row) => row.active)
  const band = pointed ?? (focused && onShow >= 0 && rows[onShow].flags ? { row: onShow, ...runAt(rows[onShow].flags, Math.floor(hour)) } : null)
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    clock.setPlaying(false)
    clock.setHour(Math.min(from + Math.floor(fraction * count), to - 1))
  }

  return (
    <section className={folded ? 'sl-river is-folded' : 'sl-river'} aria-label="Time" style={{ '--sl-label-chars': longest, '--sl-date-chars': longestDate } as CSSProperties}>
      {/* One row. The moment on the time bar comes first: its date, what is up at the scenario's site
          then, how far the Sun and Earth are above the skyline. Then how the rows are shown. What does not
          fit the row's width is left out or goes into "More"; "Fold" stays at the right end. */}
      <div className="sl-river-top">
        <div ref={head.ref} className="sl-strip-head sl-river-head">
          <button type="button" className="sl-round" aria-label={clock.playing ? 'Pause' : 'Play'} title={TIME_KEYS_MEAN} onClick={() => clock.setPlaying(!clock.playing)}>
            {clock.playing ? '❚❚' : '▶'}
          </button>
          {/* At the narrowest the date drops "UTC" and the chip is only as wide as its words. */}
          <output className={inHead.roomy ? 'sl-now' : 'sl-now is-tight'} title={inHead.roomy ? undefined : 'UTC'}>
            {inHead.roomy ? clockTime(start, hour) : clockTime(start, hour).replace(/ UTC$/, '')}
          </output>
          <span className={`sl-chip${moment.state ? ` is-${moment.state}` : ''}${inHead.roomy ? '' : ' is-tight'}`}>
            <i className={`sl-key${moment.state ? ` is-${moment.state}` : ''}`} aria-hidden="true" /> {moment.words ?? (moment.state ? STATE_CHIP[moment.state] : '…')}
          </span>
          {/* The heights above the skyline are the door to the skyline itself: a press unfolds the strip above this bar, and folds it again. */}
          {doorInRow && (
            <button type="button" className="sl-moment-heights sl-sky-door" aria-expanded={sky.open} aria-controls="sl-sky" title={`${ABOVE_SKYLINE_MEANS} Press to ${sky.open ? 'fold' : 'see'} the skyline all the way round, with the Sun's and Earth's paths.`} onClick={sky.onToggle}>
              Sun {moment.sunAboveDeg === null ? '…' : degWords(moment.sunAboveDeg)} · Earth {moment.earthAboveDeg === null ? '…' : degWords(moment.earthAboveDeg)} above the skyline <span aria-hidden="true">{sky.open ? '▾' : '▸'}</span>
            </button>
          )}
          {shortDoor && (
            <button type="button" className="sl-small sl-sky-door" aria-expanded={sky.open} aria-controls="sl-sky" title={`The skyline all the way round, with the Sun's and Earth's paths. Press to ${sky.open ? 'fold' : 'see'} it.`} onClick={sky.onToggle}>
              Skyline <span aria-hidden="true">{sky.open ? '▾' : '▸'}</span>
            </button>
          )}
          {!folded && inHead.zooms && zooms}
          {!folded && inHead.legend && legend}
          {inHead.speed && speed}
          {inHead.earthDay && earthDayBox}
          {/* "More" is there only when something did not fit the row. */}
          {menuHolds && (
            <button type="button" className="sl-small sl-more" aria-label="More for the time bar" aria-haspopup="true" aria-expanded={more} title="More for the time bar" onClick={() => setMore(!more)}>
              ⋯
            </button>
          )}
          <button type="button" className="sl-small sl-fold" aria-expanded={!folded} onClick={() => onFold(!folded)}>
            {folded ? 'Open' : 'Fold'}
          </button>
        </div>
        {more && menuHolds && (
          <div ref={menu} className="sl-menu" role="group" aria-label="More for the time bar">
            {!doorInRow && !shortDoor && (
              <button
                type="button"
                className="sl-small sl-sky-door"
                aria-expanded={sky.open}
                aria-controls="sl-sky"
                title="The skyline all the way round, with the Sun's and Earth's paths"
                onClick={() => {
                  sky.onToggle()
                  setMore(false)
                }}
              >
                {sky.open ? 'Fold the skyline' : 'Show the skyline'}
              </button>
            )}
            {!inHead.speed && <label>Speed {speed}</label>}
            {!folded && !inHead.zooms && zooms}
            {!folded && !inHead.legend && legend}
            {!inHead.earthDay && earthDayBox}
          </div>
        )}
      </div>
      {!folded && (
        <div className="sl-rows">
          {rows.map((row, i) => (
            <div key={row.key} className="sl-row">
              {/* The letter and the date always show in full. The site comes after them, only when the
                  scenarios are at different sites, and is what is shortened if the label does not fit. */}
              <button type="button" className={row.label.date ? 'sl-row-name has-date' : 'sl-row-name'} aria-pressed={row.active} title={`${row.letter} · ${row.full}`} aria-label={`Scenario ${row.letter}: ${row.full}`} onClick={() => onSelect(row.key)}>
                <span className="sl-row-date">
                  {row.letter}
                  {row.label.date && ` · ${row.label.date}`}
                </span>
                {row.label.site && <span className="sl-row-site"> · {row.label.site}</span>}
              </button>
              <div className="sl-track">
                <svg viewBox={`0 0 ${count} 12`} preserveAspectRatio="none" aria-hidden="true">
                  {row.flags &&
                    stateRuns(row.flags, from, to).map((run) => (
                      <rect key={run.from} className={`sl-run is-${run.state}`} x={run.from} y={BAND[run.state].y} width={run.to - run.from} height={BAND[run.state].height} />
                    ))}
                  {/* How long the mission runs from its landing. */}
                  {row.landing < to && row.landing + missionHours > from && (
                    <rect className="sl-mission" x={Math.max(row.landing - from, 0)} y={0} width={Math.min(row.landing + missionHours, to) - Math.max(row.landing, from)} height={1.6} />
                  )}
                </svg>
                {row.landing >= from && row.landing < to && <span className="sl-landing" style={{ left: at(row.landing - from) }} />}
                {/* What the band under the pointer is, and for how long: over the middle of what shows of it. */}
                {band && band.row === i && (
                  <span className="sl-band-tip" role="tooltip" style={{ '--at': at((Math.max(band.from, from) + Math.min(band.to, to)) / 2 - from) } as CSSProperties}>
                    {bandWords(start, band, STATE_CHIP[band.state])}
                  </span>
                )}
              </div>
            </div>
          ))}
          {earthRow && zoom !== 'year' && (
            <div className="sl-row">
              <span className="sl-row-name is-plain">A day on Earth, at {EVERYDAY_LAT_DEG}°N</span>
              <div className="sl-track">
                <svg viewBox={`0 0 ${count} 12`} preserveAspectRatio="none" aria-hidden="true">
                  {earthDay?.map((up, sample) => up && <rect key={sample} className="sl-run is-sun" x={sample} y={0} width={1} height={8} />)}
                </svg>
              </div>
            </div>
          )}
          <div className="sl-row sl-axis" aria-hidden="true">
            <span />
            <div className="sl-track">
              {ticks.map((tick) => (
                <span key={tick.at} style={{ left: at(tick.at) }}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {/* One playhead through every row; drag anywhere to move time, or use the arrow keys on it. */}
          <div
            className="sl-seek"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              dragging.current = true
              setPointed(null)
              seek(event)
            }}
            onPointerMove={(event) => {
              if (dragging.current) seek(event)
              else if (event.pointerType !== 'touch') point(event)
            }}
            onPointerLeave={() => setPointed(null)}
            onPointerUp={() => {
              dragging.current = false
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          >
            <span className="sl-playhead" style={{ left: at(hour - from + 0.5) }} />
            <input type="range" aria-label="Time" aria-valuetext={clockTime(start, hour)} min={from} max={to - 1} step={1} value={hour} onChange={(event) => clock.setHour(Number(event.target.value))} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
          </div>
        </div>
      )}
    </section>
  )
}
