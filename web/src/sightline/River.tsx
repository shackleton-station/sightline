import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { loadEarthSun } from '../data/loadSite'
import { earthPath, EVERYDAY_LAT_DEG } from '../lib/earthSun'
import { locateHour } from '../lib/mission'
import type { RiverSegment, RiverState } from '../lib/river'
import { bandWords, clockTime, DEFAULT_SPEED, type RiverZoom, riverTicks, riverWindow, runAt, SPEEDS, stateAt, stateRuns, TIME_KEYS_MEAN } from '../lib/sightline'
import type { Clock } from './hooks'
import { HourlyProblem } from './hourlyExport'
import { axisName, flagPlaces, labelSide, missionLabel, type RiverScenario, scenarioRows } from './riverRows'
import { BAND, STATE_CHIP } from './states'
import './river.css'

/** One scenario on the time bar (`riverRows.ts`). The name is the one the screen has always passed. */
export type RiverRow = RiverScenario

interface Props {
  start: string
  /** How many hours the data holds. */
  hours: number
  clock: Clock
  /** The whole hour on the time bar. */
  hour: number
  /** That moment at the scenario on show: what is up, and how far the Sun's and Earth's centres are above the ridge. Null parts are still loading. */
  moment: { state: RiverState | null; /** The chip's words: what is up, saying so when only part of Earth shows. */ words: string | null }
  rows: RiverRow[]
  /** How long the mission lasts from its landing, in hours. */
  missionHours: number
  folded: boolean
  onFold: (folded: boolean) => void
  /** Starts the short guide to the time bar, offered in its "More" menu; null while a tour or guide is on. */
  onShowHow?: (() => void) | null
  onSelect: (key: string) => void
  /** The skyline strip above this bar ("What the lander sees"): whether it is open, and its door, which is this bar's readout of the Sun's and Earth's heights. */
  /** Make and save the hour-by-hour file of the scenario on show, offered under "More"; rejects when it cannot be made. */
  onHourly: () => Promise<void>
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


/** A flag's width and the room the selected mission's label needs, in rem; the styles use the same numbers. */
const FLAG_REM = 1.1
const LABEL_REM = 7.6
/** The header's width, in rem, under which it takes its tight form. */
const TIGHT_UNDER_REM = 46
/** The header's width, in rem, under which the key does not fit beside the name. */
const KEY_ROOM_REM = 32

/**
 * The time bar, "When the Sun and Earth are in view": one row per scenario on one time axis, in
 * letter order, coloured by what is in view at its site. Each row has its scenario's lettered flag
 * at its landing hour and its mission as a box from there, with the row dimmed outside it; the
 * scenario on show has the marked box. One line through every row is the hour on show, with a
 * handle at its top and its date under it. Drag anywhere on the rows to move time, or press a flag
 * to choose that scenario.
 */
export function River({ start, hours, clock, hour, moment, rows, missionHours, folded, onFold, onShowHow = null, onSelect, onHourly }: Props) {
  const [zoom, setZoom] = useState<RiverZoom>('month')
  const [earthRow, setEarthRow] = useState(false)
  const { from, to } = riverWindow(start, hour, zoom, hours)
  const count = to - from
  const ticks = useMemo(() => riverTicks(start, from, to, zoom), [start, from, to, zoom])
  // At a year's width an Earth day is narrower than a pixel, so the row is offered up to a month.
  const earthDay = useEarthDay(start, from, to, earthRow && zoom !== 'year' && !folded)
  const at = (sample: number) => `${(100 * sample) / count}%`
  const lanes = scenarioRows(rows)
  // The label column is as wide as its longest label needs (a letter, then the site's name), up to a limit (set in the styles); past it a name is shortened.
  const longest = Math.max(...lanes.map((lane) => lane.siteName.length)) + 2

  // The rows' and the header's widths in pixels and the size of 1rem: to stand flags side by side where
  // their landings are close, and to know whether the header has room for the heights in full.
  const seekBox = useRef<HTMLDivElement>(null)
  const headBox = useRef<HTMLDivElement>(null)
  const [track, setTrack] = useState({ width: 0, head: 0, rem: 16 })
  useEffect(() => {
    const measure = () =>
      setTrack({
        width: seekBox.current?.getBoundingClientRect().width ?? 0,
        head: headBox.current?.getBoundingClientRect().width ?? 0,
        rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
      })
    measure()
    const watcher = new ResizeObserver(measure)
    if (seekBox.current) watcher.observe(seekBox.current)
    if (headBox.current) watcher.observe(headBox.current)
    return () => watcher.disconnect()
  }, [folded])
  const flagWidth = FLAG_REM * track.rem
  // On a phone the key stays in the header, which may wrap there.
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 760px)')
    const follow = () => setPhone(narrow.matches)
    narrow.addEventListener('change', follow)
    return () => narrow.removeEventListener('change', follow)
  }, [])
  // A narrow header tightens. Narrower still (a small laptop with a panel open) its key goes into
  // "More", so the header stays two lines.
  const tight = track.head > 0 && track.head < TIGHT_UNDER_REM * track.rem
  const keyInMenu = !phone && track.head > 0 && track.head < KEY_ROOM_REM * track.rem
  const key = (
    <span className="sl-legend">
      <i className="sl-key is-sun" /> Sun <i className="sl-key is-earth" /> Earth <i className="sl-key is-both" /> Both <i className="sl-key is-none" /> Neither
    </span>
  )

  // Two small menus open upward from the header: the speeds, from the play button, and "More".
  const [menu, setMenu] = useState<'speed' | 'more' | null>(null)
  const menuBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target instanceof Element && (menuBox.current?.contains(event.target) || event.target.closest('.sl-more, .sl-speed')))) setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])
  // The hourly file may have a month or two to read first; its line under "More" says so, and says why if it cannot be made.
  const [hourly, setHourly] = useState<{ kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string }>({ kind: 'idle' })
  const saveHourly = () => {
    if (hourly.kind === 'working') return
    setHourly({ kind: 'working' })
    onHourly().then(
      () => {
        setHourly({ kind: 'idle' })
        setMenu(null)
      },
      (reason: unknown) => {
        if (!(reason instanceof HourlyProblem)) console.error(reason)
        // Why it failed is said under "More", which opens for it.
        setMenu('more')
        setHourly({ kind: 'failed', message: reason instanceof HourlyProblem ? reason.message : 'The file could not be made just now. Try again in a moment.' })
      },
    )
  }
  const speed = SPEEDS.find((one) => one.hoursPerSecond === clock.hoursPerSecond) ?? SPEEDS.find((one) => one.hoursPerSecond === DEFAULT_SPEED) ?? SPEEDS[0]
  // At a year's width an Earth day is narrower than a pixel, so the row is offered up to a month, and only while the rows are open.
  const earthDayOffered = zoom !== 'year' && !folded
  // Whether the hourly file is the only thing "More" would hold.
  const onlyHourly = !earthDayOffered && !(keyInMenu && !folded)

  const dragging = useRef(false)
  // The band under the pointer, or, with the keyboard on the time bar, the band the line is in on the
  // row of the scenario on show: which row, and the whole stretch it belongs to. Its words show over its own row.
  const [pointed, setPointed] = useState<({ row: number } & RiverSegment) | null>(null)
  const [focused, setFocused] = useState(false)
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const tracks = [...(event.currentTarget.parentElement?.querySelectorAll('.sl-site-row .sl-track') ?? [])]
    const row = tracks.findIndex((one) => event.clientY >= one.getBoundingClientRect().top - 3 && event.clientY <= one.getBoundingClientRect().bottom + 3)
    const flags = row >= 0 ? lanes[row].flags : null
    if (!flags) return setPointed(null)
    const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    const run = runAt(flags, Math.min(from + Math.floor(fraction * count), to - 1))
    // Moving along the same band changes nothing: the words are drawn again only for another band.
    setPointed((before) => (before && before.row === row && before.from === run.from ? before : { row, ...run }))
  }
  const onShow = lanes.findIndex((lane) => lane.active)
  const shownFlags = onShow >= 0 ? lanes[onShow].flags : null
  const band = pointed ?? (focused && shownFlags ? { row: onShow, ...runAt(shownFlags, Math.floor(hour)) } : null)
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    clock.setPlaying(false)
    clock.setHour(Math.min(from + Math.floor(fraction * count), to - 1))
  }

  return (
    <section className={folded ? 'sl-river is-folded' : 'sl-river'} aria-label="When the Sun and Earth are in view" style={{ '--sl-label-chars': longest, '--sl-date-chars': longest } as CSSProperties}>
      {/* The header. Open: play, the section's name and its key, then what is in view at the hour on
          show, then how much time the rows cover and "Fold". The hour's date is under the line in the
          rows, so it is not written here; folded, there is no line, and the date takes the name's place. */}
      <div className="sl-river-top">
        <div ref={headBox} className={tight ? 'sl-strip-head sl-river-head is-tight' : 'sl-strip-head sl-river-head'}>
          <span className="sl-play">
            <button type="button" className="sl-round" aria-label={clock.playing ? 'Pause' : 'Play'} title={TIME_KEYS_MEAN} onClick={() => clock.setPlaying(!clock.playing)}>
              {clock.playing ? '❚❚' : '▶'}
            </button>
            <button type="button" className="sl-small sl-speed" aria-label={`Speed: ${speed.label}`} aria-haspopup="true" aria-expanded={menu === 'speed'} title={`Changes how fast time plays. Now ${speed.label}.`} onClick={() => setMenu(menu === 'speed' ? null : 'speed')}>
              ▾
            </button>
          </span>
          {folded ? (
            <output className="sl-now">{clockTime(start, hour)}</output>
          ) : (
            <>
              <h2 className="sl-river-name">When the Sun and Earth are in view</h2>
              {!keyInMenu && key}
            </>
          )}
          {/* What is in view and the tools keep together: on the name's line where there is room, else on a line of their own, the chip at its start and the tools at its end. */}
          <span className="sl-river-second">
            <span className="sl-moment">
              <span className={`sl-chip${moment.state ? ` is-${moment.state}` : ''}`}>
                <i className={`sl-key${moment.state ? ` is-${moment.state}` : ''}`} aria-hidden="true" /> {moment.words ?? (moment.state ? STATE_CHIP[moment.state] : '…')}
              </span>
            </span>
            <span className="sl-river-tools">
              {!folded && (
                <span className="sl-zooms" role="group" aria-label="How much time the rows show">
                  {ZOOMS.map((option) => (
                    <button key={option.id} type="button" aria-pressed={zoom === option.id} onClick={() => setZoom(option.id)}>
                      {option.label}
                    </button>
                  ))}
                </span>
              )}
              {/* "More" holds what is rarely needed (the hourly file, "A day on Earth") and what a narrow header has no room for: the key.
                  When the hourly file is all it would hold, the file's own button stands in its place: a menu of one is a press too many. */}
              {onlyHourly && hourly.kind !== 'failed' ? (
                <button type="button" className="sl-small sl-hourly" aria-busy={hourly.kind === 'working'} title="Saves a CSV file of the scenario on show: one row for each hour of its mission." onClick={saveHourly}>
                  {hourly.kind === 'working' ? 'Reading…' : 'Hourly CSV'}
                </button>
              ) : (
              <button
                type="button"
                className="sl-small sl-more"
                aria-label="More for the time bar"
                aria-haspopup="true"
                aria-expanded={menu === 'more'}
                title="Opens more for the time bar: the hourly file and “A day on Earth”."
                onClick={() => {
                  setMenu(menu === 'more' ? null : 'more')
                  if (hourly.kind === 'failed') setHourly({ kind: 'idle' })
                }}
              >
                ⋯
              </button>
              )}
              <button type="button" className="sl-small sl-fold" aria-expanded={!folded} onClick={() => onFold(!folded)}>
                {folded ? 'Open' : 'Fold'}
              </button>
            </span>
          </span>
        </div>
        {menu === 'speed' && (
          <div ref={menuBox} className="sl-menu sl-speed-menu" role="group" aria-label="Speed">
            {SPEEDS.map((one) => (
              <button
                key={one.hoursPerSecond}
                type="button"
                className="sl-small"
                aria-pressed={one === speed}
                onClick={() => {
                  clock.setSpeed(one.hoursPerSecond)
                  setMenu(null)
                }}
              >
                {one.label}
              </button>
            ))}
          </div>
        )}
        {menu === 'more' && (
          <div ref={menuBox} className="sl-menu" role="group" aria-label="More for the time bar">
            {keyInMenu && !folded && key}
            {onShowHow && (
              <button
                type="button"
                className="sl-link sl-show-how"
                onClick={() => {
                  setMenu(null)
                  onShowHow()
                }}
              >
                Show me how
              </button>
            )}
            {earthDayOffered && (
              <label className="sl-check">
                <input type="checkbox" checked={earthRow} onChange={(event) => setEarthRow(event.target.checked)} /> A day on Earth
              </label>
            )}
            {/* The same file as the Planner's Export: the scenario on show over its mission, one row for each hour. */}
            <button type="button" className="sl-small sl-hourly" aria-busy={hourly.kind === 'working'} title="Saves a CSV file of the scenario on show: one row for each hour of its mission." onClick={saveHourly}>
              {hourly.kind === 'working' ? 'Reading the hours…' : 'Hourly Sun and Earth (CSV)'}
            </button>
            {hourly.kind === 'failed' && (
              <span className="sl-hourly-problem" role="alert">
                {hourly.message}
              </span>
            )}
          </div>
        )}
      </div>
      {!folded && (
        <div className="sl-rows">
          {/* Room above the first row for the line's handle, clear of the flags. */}
          <div className="sl-row sl-lane" aria-hidden="true">
            <span />
            <span />
          </div>
          {lanes.map((one, n) => {
            // The flag is centred on its landing; one that lands outside the hours on show stands at that edge.
            const place = track.width > 0 ? flagPlaces([((one.landing + 0.5 - from) / count) * track.width], track.width, flagWidth)[0] : null
            const side = place !== null ? labelSide([place], 0, track.width, flagWidth, LABEL_REM * track.rem) : 'right'
            const where = one.landing < from ? 'before' : one.landing >= to ? 'after' : null
            const state = one.flags ? stateAt(one.flags, one.landing) : null
            const first = Math.max(one.landing, from)
            const end = Math.min(one.landing + missionHours, to)
            return (
              <div key={one.key} className={`sl-row sl-site-row${one.active ? ' is-on-show' : ''}${band && band.row === n ? ' is-pointed' : ''}`} data-site={one.site} data-scenario={one.letter}>
                <span className="sl-site-name" title={`Scenario ${one.letter}, at ${one.siteName}: what is in view there, hour by hour.`}>
                  <b className="sl-row-letter">{one.letter}</b> {one.siteName}
                </span>
                <div className="sl-site-track">
                  <div className="sl-flags">
                    <button
                      type="button"
                      className={`sl-flag${state ? ` is-${state}` : ''}${where ? ` is-${where}` : ''}`}
                      aria-pressed={one.active}
                      aria-label={`Scenario ${one.letter}: ${one.full}`}
                      title={`Scenario ${one.letter}: lands at ${one.siteName} on ${one.full.replace(`${one.siteName} · `, '')}${where ? `, ${where} the days shown` : ''}. ${one.active ? 'Press to move the time bar back to its landing.' : 'Press to select it and move the time bar to its landing.'}`}
                      data-hour={one.landing}
                      style={{ left: place !== null ? `${place}px` : `calc(${at(Math.min(Math.max(one.landing + 0.5 - from, 0), count))} - ${FLAG_REM / 2}rem)` }}
                      onClick={() => {
                        // A flag is its landing's mark: a press selects the scenario and goes to that hour.
                        onSelect(one.key)
                        clock.setHour(one.landing)
                      }}
                    >
                      {where === 'before' && '‹'}
                      {one.letter}
                      {where === 'after' && '›'}
                    </button>
                    {/* The mission on show, named beside its flag. */}
                    {one.active && place !== null && side && (
                      <span className={`sl-span-label is-${side}`} style={{ left: `${side === 'right' ? place + flagWidth : place}px` }}>
                        {missionLabel(one.letter, missionHours)}
                      </span>
                    )}
                  </div>
                  <div className="sl-track">
                    <svg viewBox={`0 0 ${count} 12`} preserveAspectRatio="none" aria-hidden="true">
                      {one.flags &&
                        stateRuns(one.flags, from, to).map((run) => (
                          <rect key={run.from} className={`sl-run is-${run.state}`} x={run.from} y={BAND[run.state].y} width={run.to - run.from} height={BAND[run.state].height} />
                        ))}
                    </svg>
                    {/* Every row draws its own mission, from its landing to its end, and is dimmed on either side of it: bright
                        inside the mission, dim outside. The scenario on show has the full outline; the others a thin one. */}
                    {end > first && (
                      <span
                        className={`sl-span${one.active ? ' is-lit' : ''}${one.landing >= from ? ' has-start' : ''}${one.landing + missionHours <= to ? ' has-end' : ''}`}
                        data-scenario={one.letter}
                        data-hours={end - first}
                        style={{ left: at(first - from), width: at(end - first) }}
                      />
                    )}
                    {one.landing > from && <span className="sl-dim" style={{ left: 0, width: at(Math.min(one.landing, to) - from) }} />}
                    {one.landing + missionHours < to && <span className="sl-dim" style={{ left: at(Math.max(one.landing + missionHours, from) - from), right: 0 }} />}
                  </div>
                </div>
              </div>
            )
          })}
          {earthRow && zoom !== 'year' && (
            <div className="sl-row">
              <span className="sl-site-name">A day on Earth, at {EVERYDAY_LAT_DEG}°N</span>
              <div className="sl-track">
                <svg viewBox={`0 0 ${count} 12`} preserveAspectRatio="none" aria-hidden="true">
                  {earthDay?.map((up, sample) => up && <rect key={sample} className="sl-run is-sun" x={sample} y={0} width={1} height={8} />)}
                </svg>
              </div>
            </div>
          )}
          {/* The axis says what it is an axis of, at its left; under its labels, the date of the hour on show, at the foot of the line. */}
          <div className="sl-row sl-axis">
            <span className="sl-axis-name">{axisName(start, from, zoom)}</span>
            <div className="sl-track">
              {ticks.map((tick) => (
                <span key={tick.at} aria-hidden="true" style={{ left: at(tick.at) }}>
                  {tick.label}
                </span>
              ))}
              {/* The line runs on down past the axis's labels to its date, which sits under them and covers none. */}
              <i className="sl-line-foot" aria-hidden="true" style={{ left: at(hour - from + 0.5) }} />
              <output className="sl-now" style={{ '--at': at(hour - from + 0.5) } as CSSProperties}>
                {clockTime(start, hour)}
              </output>
            </div>
          </div>
          {/* One line through every row for the hour on show; drag its handle or anywhere on the rows to move time, or use the arrow keys. */}
          <div
            ref={seekBox}
            className="sl-seek"
            onPointerDown={(event) => {
              // Keeping the pointer is a help, not a need: a pointer the browser does not know (a test's) still drags.
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                // Drag on without it.
              }
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
            <span className="sl-playhead" style={{ left: at(hour - from + 0.5) }}>
              <span className="sl-line-handle" />
            </span>
            {/* What the band under the pointer is, and for how long: above the rows, over the middle of what shows of it,
                so it never lies on a flag or on the selected mission's label. Its row's name is marked meanwhile. */}
            {band && (
              <span className="sl-band-tip" role="tooltip" style={{ '--at': at((Math.max(band.from, from) + Math.min(band.to, to)) / 2 - from) } as CSSProperties}>
                {bandWords(start, band, STATE_CHIP[band.state])}
              </span>
            )}
            <input type="range" aria-label="Time" aria-valuetext={clockTime(start, hour)} min={from} max={to - 1} step={1} value={hour} onChange={(event) => clock.setHour(Number(event.target.value))} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
          </div>
        </div>
      )}
    </section>
  )
}
