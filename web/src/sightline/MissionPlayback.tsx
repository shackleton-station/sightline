import { area, line, scaleLinear } from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { HorizonPoint, TrackPoint } from '../data/contract'
import type { SiteFlags } from '../lib/flags'
import { hourOf, missionEarth, type Requirements } from '../lib/mission'
import { hoursUntilChange } from '../lib/nextChange'
import { splitAtWrap } from '../lib/panorama'
import { skylineCentre, skylineDomain, skylineHorizon, skylineX } from '../lib/sightline'
import { useWidth } from '../lib/useWidth'

export interface PlaybackPick {
  letter: string
  name: string
  flags: SiteFlags | null
  /** The landing hour, ISO. */
  t: string
  /** The mission hour by hour from the landing; undefined while it loads, null if it failed. */
  track: TrackPoint[] | null | undefined
  horizon: HorizonPoint[] | null | undefined
}

interface Props {
  picks: PlaybackPick[]
  requirements: Requirements
}

/** The playback's speeds, in mission hours a second. */
const SPEEDS = [
  { label: '½ day/s', hoursPerSecond: 12 },
  { label: '1 day/s', hoursPerSecond: 24 },
  { label: '3 days/s', hoursPerSecond: 72 },
]

function compact(hours: number): string {
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

/** "Sunset in 2d 4h", "Earthrise in 9h", or that it doesn't happen before the data ends. */
function nextWords(body: 'Sun' | 'Earth', flags: boolean[], hour: number): { text: string; up: boolean } {
  const up = flags[hour] === true
  const hours = hoursUntilChange(flags, hour, 1)
  const event = body === 'Sun' ? (up ? 'Sunset' : 'Sunrise') : up ? 'Earthset' : 'Earthrise'
  return { text: hours === null ? `No ${event.toLowerCase()} in our data` : `${event} in ${compact(hours)}`, up }
}

const HEIGHT = 96
const MARGIN = { top: 6, bottom: 12, left: 2, right: 2 }

/** One pick's skyline with the Sun and Earth where they are at this hour of its mission, and their paths faint behind. */
function PlaybackSky({ pick, hour, requirements }: { pick: PlaybackPick; hour: number; requirements: Requirements }) {
  const [ref, width] = useWidth()
  const drawn = useMemo(() => {
    if (!pick.track || !pick.horizon || pick.track.length === 0) return null
    const centre = skylineCentre(pick.track)
    return {
      centre,
      land: skylineHorizon(pick.horizon, centre),
      sun: splitAtWrap(pick.track.map((point) => ({ az: skylineX(point.sun_az, centre), el: point.sun_el }))),
      earth: splitAtWrap(pick.track.map((point) => ({ az: skylineX(point.earth_az, centre), el: point.earth_el }))),
      domain: skylineDomain(pick.horizon, pick.track),
    }
  }, [pick.track, pick.horizon])
  const now = pick.track ? (pick.track[Math.min(hour, pick.track.length - 1)] ?? null) : null
  const landing = pick.flags ? hourOf(pick.flags.start, pick.t) : 0
  const earthFlags = useMemo(() => (pick.flags ? missionEarth(pick.flags, requirements) : null), [pick.flags, requirements])
  const sun = pick.flags ? nextWords('Sun', pick.flags.sun, landing + hour) : null
  const earth = earthFlags ? nextWords('Earth', earthFlags, landing + hour) : null
  const bottom = HEIGHT - MARGIN.bottom
  const x = scaleLinear([0, 360], [MARGIN.left, Math.max(width - MARGIN.right, MARGIN.left + 1)])
  const y = scaleLinear(drawn?.domain ?? [-1, 1], [bottom, MARGIN.top])
  const ground = drawn
    ? area<{ x: number; el: number }>()
        .x((point) => x(point.x))
        .y0(bottom)
        .y1((point) => y(point.el))(drawn.land)
    : null
  const path = line<{ az: number; el: number }>()
    .x((point) => x(point.az))
    .y((point) => y(point.el))
  return (
    <figure className="np-play-card">
      <figcaption>
        <span className="pl-sunrow-letter">{pick.letter}</span> {pick.name}
      </figcaption>
      <div className="np-play-sky" ref={ref}>
        {width > 0 && drawn ? (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${pick.name}: the Sun ${now?.sun_up ? 'in view' : 'hidden'} and Earth ${now?.earth_up ? 'in view' : 'hidden'} at this hour of the mission`}>
            {drawn.sun.map((segment, i) => (
              <path key={`s${i}`} className="np-play-path is-sun" d={path(segment) ?? ''} />
            ))}
            {drawn.earth.map((segment, i) => (
              <path key={`e${i}`} className="np-play-path is-earth" d={path(segment) ?? ''} />
            ))}
            <path className="np-play-ground" d={ground ?? ''} />
            {now && (
              <>
                <circle className={`np-play-dot is-earth ${now.earth_up ? '' : 'is-hidden'}`} cx={x(skylineX(now.earth_az, drawn.centre))} cy={y(now.earth_el)} r={5} />
                <circle className={`np-play-dot is-sun ${now.sun_up ? '' : 'is-hidden'}`} cx={x(skylineX(now.sun_az, drawn.centre))} cy={y(now.sun_el)} r={6} />
              </>
            )}
          </svg>
        ) : (
          <p className="sl-quiet">{pick.track === null || pick.horizon === null ? 'The skyline didn’t load.' : 'Drawing the skyline…'}</p>
        )}
      </div>
      <p className={`np-play-state ${sun?.up ? 'is-up' : 'is-down'}`}>
        <i className="np-play-key is-sun" /> {sun ? sun.text : '…'}
      </p>
      <p className={`np-play-state ${earth?.up ? 'is-up' : 'is-down'}`}>
        <i className="np-play-key is-earth" /> {earth ? earth.text : '…'}
      </p>
      {now && (
        <p className="np-play-height">
          Sun {now.sun_el.toFixed(1)}° {now.sun_up ? 'up' : 'hidden'}
        </p>
      )}
    </figure>
  )
}

/**
 * Every pick's mission played at once, from landing to the last day: each skyline with the Sun and
 * Earth moving along their real paths, what is in view, and how long until the next sunset or
 * Earthset. One clock for all, so the picks can be watched side by side. Paused by default; with
 * reduced motion it never plays by itself, and the slider moves it by hand.
 */
export function MissionPlayback({ picks, requirements }: Props) {
  const missionH = requirements.missionDays * 24
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const last = useRef<number | null>(null)
  const exact = useRef(0)

  useEffect(() => {
    if (!playing) {
      last.current = null
      return
    }
    let frame = 0
    const step = (time: number) => {
      if (last.current !== null) {
        exact.current += ((time - last.current) / 1000) * SPEEDS[speed].hoursPerSecond
        if (exact.current >= missionH - 1) {
          exact.current = missionH - 1
          setHour(missionH - 1)
          setPlaying(false)
          return
        }
        setHour(Math.floor(exact.current))
      }
      last.current = time
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, missionH])

  const day = Math.floor(hour / 24)
  const toggle = () => {
    if (!playing && hour >= missionH - 1) {
      exact.current = 0
      setHour(0)
    }
    setPlaying(!playing)
  }

  return (
    <section className="np-play" aria-labelledby="np-play-title">
      <header className="np-play-head">
        <h3 id="np-play-title">Watch the missions</h3>
        <button type="button" className="np-play-button" aria-pressed={playing} onClick={toggle}>
          {playing ? '❚❚ Pause' : hour >= missionH - 1 ? '↺ Replay' : '▶ Play'}
        </button>
        <span className="np-play-speeds" role="group" aria-label="Speed">
          {SPEEDS.map((one, i) => (
            <button key={one.label} type="button" aria-pressed={i === speed} onClick={() => setSpeed(i)}>
              {one.label}
            </button>
          ))}
        </span>
        <span className="np-play-clock">
          {hour === 0 ? 'Landing' : `Day ${day + 1}, ${String(hour % 24).padStart(2, '0')}:00 after landing`}
        </span>
      </header>
      <input
        className="np-play-scrub"
        type="range"
        min={0}
        max={missionH - 1}
        value={hour}
        aria-label="Hour of the mission"
        aria-valuetext={`${compact(hour)} after landing`}
        onChange={(event) => {
          setPlaying(false)
          exact.current = Number(event.target.value)
          setHour(Number(event.target.value))
        }}
      />
      <div className="np-play-cards" style={{ gridTemplateColumns: `repeat(${picks.length}, minmax(0, 1fr))` }}>
        {picks.map((pick) => (
          <PlaybackSky key={pick.letter} pick={pick} hour={hour} requirements={requirements} />
        ))}
      </div>
      <p className="sl-legend">
        <i className="np-play-key is-sun" /> Sun <i className="np-play-key is-earth" /> Earth: a filled dot is in view, a ring is behind the terrain. Faint lines are each one's path over the mission.
      </p>
    </section>
  )
}
