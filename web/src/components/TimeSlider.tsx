import { useEffect, useState } from 'react'
import { formatUtc } from '../lib/timeline'

interface Props {
  times: string[]
  index: number
  onChange: (index: number) => void
  /** Shown instead of the UTC time, e.g. when the slider drives scenarios in different months. */
  label?: string
  /** For when something else is already moving time along. */
  hidePlay?: boolean
}

const PLAY_STEP_MS = 60

export function TimeSlider({ times, index, onChange, label, hidePlay = false }: Props) {
  const [playing, setPlaying] = useState(false)
  const last = times.length - 1

  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      if (index >= last) setPlaying(false)
      else onChange(index + 1)
    }, PLAY_STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, index, last, onChange])

  const togglePlaying = () => {
    if (!playing && index >= last) onChange(0)
    setPlaying(!playing)
  }

  return (
    <div className="slider">
      {!hidePlay && (
        <button type="button" onClick={togglePlaying}>
          {playing ? 'Pause' : 'Play'}
        </button>
      )}
      <input
        type="range"
        aria-label="Time"
        aria-valuetext={label ?? formatUtc(times[index])}
        min={0}
        max={last}
        value={index}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{label ?? formatUtc(times[index])}</output>
    </div>
  )
}
