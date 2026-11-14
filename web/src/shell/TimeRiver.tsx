import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../data/contract'
import { dayMarks, riverSegments, riverTime } from '../lib/river'

interface MonthStep {
  label: string
  onClick: (() => void) | null
}

interface Props {
  track: TrackPoint[]
  index: number
  onIndex: (index: number) => void
  /** Runs of hours when a landing meets the limits, as sample ranges. Shown in Plan mode. */
  landing?: { from: number; to: number }[]
  /** How long the mission lasts from the hour shown, in hours. Drawn as a bracket in Plan mode. */
  missionHours?: number
  previous?: MonthStep
  next?: MonthStep
}

const PLAY_STEP_MS = 60

/**
 * The one control for time. Its track is the month itself: green where the Sun and Earth are both
 * up, amber for the Sun alone, blue for Earth alone, dark for neither. Drag it and everything moves.
 */
export function TimeRiver({ track, index, onIndex, landing, missionHours, previous, next }: Props) {
  const [playing, setPlaying] = useState(false)
  const last = track.length - 1
  const shown = Math.min(index, last)
  const segments = useMemo(() => riverSegments(track), [track])
  const marks = useMemo(() => dayMarks(track), [track])

  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      if (shown >= last) setPlaying(false)
      else onIndex(shown + 1)
    }, PLAY_STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, shown, last, onIndex])

  const at = (sample: number) => `${(100 * sample) / Math.max(last, 1)}%`

  // Dragging anywhere on the track moves time to exactly where the pointer is.
  const dragging = useRef(false)
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    setPlaying(false)
    onIndex(Math.round(fraction * last))
  }
  const month = (step: MonthStep | undefined, side: 'before' | 'after') =>
    step && (
      <button
        type="button"
        className="river-month"
        disabled={!step.onClick}
        aria-label={`${side === 'before' ? 'Previous' : 'Next'} month: ${step.label}`}
        onClick={step.onClick ?? undefined}
      >
        {side === 'before' ? `‹ ${step.label}` : `${step.label} ›`}
      </button>
    )

  return (
    <div className="river">
      <button
        type="button"
        className="river-play"
        aria-label={playing ? 'Pause' : 'Play the month'}
        onClick={() => {
          if (!playing && shown >= last) onIndex(0)
          setPlaying(!playing)
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      {month(previous, 'before')}
      <div className="river-main">
        <div
          className="river-track"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            dragging.current = true
            seek(event)
          }}
          onPointerMove={(event) => {
            if (dragging.current) seek(event)
          }}
          onPointerUp={() => {
            dragging.current = false
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
        >
          <svg viewBox={`0 0 ${track.length} 12`} preserveAspectRatio="none" aria-hidden="true">
            {segments.map((segment) => (
              <rect key={segment.from} className={`river-${segment.state}`} x={segment.from} y={landing ? 3 : 0} width={segment.to - segment.from} height={landing ? 9 : 12} />
            ))}
            {landing?.map((run) => <rect key={run.from} className="river-landing" x={run.from} y={0} width={run.to - run.from} height={2} />)}
          </svg>
          {missionHours !== undefined && (
            <span className="river-mission" style={{ left: at(shown), width: at(Math.min(missionHours, last - shown)) }} aria-hidden="true" />
          )}
          <span className="river-cursor" style={{ left: at(shown) }} aria-hidden="true" />
          <input
            type="range"
            aria-label="Time"
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
        <div className="river-days" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark.index} style={{ left: at(mark.index) }}>
              {mark.day}
            </span>
          ))}
        </div>
      </div>
      {month(next, 'after')}
      <output className="river-time">{riverTime(track[shown].t)}</output>
    </div>
  )
}

/** What the river's colours mean. */
export function RiverKey({ landing }: { landing: boolean }) {
  return (
    <p className="river-key">
      <span className="key-pair">
        <span className="key river-both" /> Sun and Earth
      </span>{' '}
      <span className="key-pair">
        <span className="key river-sun" /> Sun only
      </span>{' '}
      <span className="key-pair">
        <span className="key river-earth" /> Earth only
      </span>{' '}
      <span className="key-pair">
        <span className="key river-none" /> Neither
      </span>
      {landing && (
        <>
          {' '}
          <span className="key-pair">
            <span className="key river-landing" /> A landing meets your limits
          </span>
        </>
      )}
    </p>
  )
}
