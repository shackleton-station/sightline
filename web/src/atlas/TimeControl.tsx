import { useEffect, useMemo, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { riverTime, runsWithin, shortTime } from '../lib/river'
import { EarthIcon, PauseIcon, PlayIcon, StepIcon, SunIcon } from './icons'

interface Props {
  track: TrackPoint[]
  index: number
  onIndex: (index: number) => void
}

/** Hours moved per play tick, cycled by the speed button. */
const SPEEDS = [1, 4, 12]
const PLAY_STEP_MS = 60

/**
 * The Atlas's time control: one 48 px bar with play, a step each way, the month as two lanes (gold
 * where the Sun is up, blue where Earth is up, each labeled by its icon) and the hour shown. The
 * range input over the lanes is the
 * real control, so arrow keys, Home and End work and a screen reader hears the date.
 */
export function TimeControl({ track, index, onIndex }: Props) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0)
  const last = track.length - 1
  const shown = Math.min(index, last)
  // Two lanes, each one plain yes/no: the hours with the Sun up, and the hours with Earth up.
  const sunRuns = useMemo(() => runsWithin(track.map((point) => point.sun_up), 0, track.length), [track])
  const earthRuns = useMemo(() => runsWithin(track.map((point) => point.earth_up), 0, track.length), [track])

  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      if (shown >= last) setPlaying(false)
      else onIndex(Math.min(shown + SPEEDS[speed], last))
    }, PLAY_STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, shown, last, speed, onIndex])

  const step = (by: number) => {
    setPlaying(false)
    onIndex(Math.min(Math.max(shown + by, 0), last))
  }

  return (
    <div className="atlas-time" role="group" aria-label="Time" data-tour="time">
      <button
        type="button"
        className="atlas-time-play"
        aria-label={playing ? 'Pause' : 'Play the month'}
        aria-pressed={playing}
        onClick={() => {
          if (!playing && shown >= last) onIndex(0)
          setPlaying(!playing)
        }}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <button type="button" className="atlas-time-step" aria-label="Back one hour" disabled={shown <= 0} onClick={() => step(-1)}>
        <StepIcon size={14} className="back" />
      </button>
      {/* What each lane is, said by its icon and, for the curious, a tooltip. */}
      <span className="atlas-time-lanes" aria-hidden="true" title="Top: hours with the Sun up. Bottom: hours with Earth up.">
        <SunIcon size={12} className="lane-sun" />
        <EarthIcon size={12} className="lane-earth" />
      </span>
      <div className="atlas-time-track">
        <svg viewBox={`0 0 ${track.length} 16`} preserveAspectRatio="none" aria-hidden="true">
          <rect className="lane-off" x={0} y={0} width={track.length} height={6} />
          <rect className="lane-off" x={0} y={10} width={track.length} height={6} />
          {sunRuns.map((run) => (
            <rect key={`s${run.from}`} className="lane-sun" x={run.from} y={0} width={run.to - run.from} height={6} />
          ))}
          {earthRuns.map((run) => (
            <rect key={`e${run.from}`} className="lane-earth" x={run.from} y={10} width={run.to - run.from} height={6} />
          ))}
        </svg>
        <span className="atlas-time-cursor" style={{ left: `${(100 * shown) / Math.max(last, 1)}%` }} aria-hidden="true" />
        <input
          type="range"
          aria-label="Hour of the month"
          aria-valuetext={riverTime(track[shown].t)}
          min={0}
          max={last}
          value={shown}
          onChange={(event) => {
            setPlaying(false)
            onIndex(Number(event.target.value))
          }}
        />
      </div>
      <button type="button" className="atlas-time-step" aria-label="Forward one hour" disabled={shown >= last} onClick={() => step(1)}>
        <StepIcon size={14} />
      </button>
      <output className="atlas-time-now">{shortTime(track[shown].t)}</output>
      <button type="button" className="atlas-time-speed" aria-label={`Play speed: ${SPEEDS[speed]} hours a step`} onClick={() => setSpeed((speed + 1) % SPEEDS.length)}>
        {SPEEDS[speed]}×
      </button>
    </div>
  )
}
