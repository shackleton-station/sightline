import type { TrackPoint } from '../data/contract'

/** What is up at one hour: the colour of the time river there. */
export type RiverState = 'both' | 'sun' | 'earth' | 'none'

/** A run of hours in the same state. `from` and `to` are sample numbers; `to` is not included. */
export interface RiverSegment {
  from: number
  to: number
  state: RiverState
}

export function riverState(point: TrackPoint): RiverState {
  if (point.sun_up && point.earth_up) return 'both'
  if (point.sun_up) return 'sun'
  return point.earth_up ? 'earth' : 'none'
}

/** The month as runs of hours with the same things up, in order, covering every sample once. */
export function riverSegments(track: TrackPoint[]): RiverSegment[] {
  const segments: RiverSegment[] = []
  track.forEach((point, i) => {
    const state = riverState(point)
    const last = segments[segments.length - 1]
    if (last && last.state === state) last.to = i + 1
    else segments.push({ from: i, to: i + 1, state })
  })
  return segments
}

/** Runs of set hours in `flags[offset .. offset + count)`, as sample ranges within that window. */
export function runsWithin(flags: ArrayLike<number | boolean> | null, offset: number, count: number): { from: number; to: number }[] {
  if (!flags) return []
  const runs: { from: number; to: number }[] = []
  for (let i = 0; i < count; i += 1) {
    if (!flags[offset + i]) continue
    const last = runs[runs.length - 1]
    if (last && last.to === i) last.to = i + 1
    else runs.push({ from: i, to: i + 1 })
  }
  return runs
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2027-05-13T12:00:00Z" as "13 May 2027 · 12:00 UTC". */
export function riverTime(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)} · ${iso.slice(11, 16)} UTC`
}

/** "2027-05-13T12:00:00Z" as "13 May · 12:00 UTC", short enough for one line beside the Atlas's time bar. */
export function shortTime(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)} · ${iso.slice(11, 16)} UTC`
}

/** The samples where a new day starts on a round date, for labels under the river: 1, 5, 10, ... */
export function dayMarks(track: TrackPoint[], every = 5): { index: number; day: number }[] {
  return track.flatMap((point, index) => {
    const day = Number(point.t.slice(8, 10))
    const midnight = point.t.slice(11, 13) === '00'
    return midnight && (day === 1 || day % every === 0) ? [{ index, day }] : []
  })
}
