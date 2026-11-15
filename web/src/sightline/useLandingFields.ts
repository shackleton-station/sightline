import { useEffect, useRef, useState } from 'react'
import { type FieldAnswer, type FieldAsk, fieldKey, fieldNow, fieldProgress, loadLandingField, placeKey, watchFields } from '../data/landingField'
import { type FieldReading, readField } from '../lib/landingField'
import type { Miss, Spread } from '../lib/landingOdds'
import type { SightlineMission } from '../lib/sightlineMission'

/** One scenario's landing points, as far as they have been worked out. */
export interface FieldState {
  /** The answer on hand: the ask's own, or (`stale`) the last one for the same place and mission while the ask's is worked out. */
  answer: FieldAnswer | null
  stale: boolean
  /** How much of the ask's own answer is done, from 0 to 1. */
  progress: number
  /** The terrain or the Sun's and Earth's positions could not be read. */
  failed: boolean
}

const IDLE: FieldState = { answer: null, stale: false, progress: 0, failed: false }

/**
 * The landing points around each scenario's target (`data/landingField.ts`): null for a scenario
 * that is not asked for. While a lander's accuracy is being changed the lattice changes with it,
 * so the last answer for the same place and mission stays on show until the new one is in.
 */
export function useLandingFields(asks: (FieldAsk | null)[]): FieldState[] {
  const [, setArrived] = useState(0)
  const failed = useRef(new Set<string>())
  const last = useRef(new Map<number, { place: string; answer: FieldAnswer }>())
  const keys = asks.map((ask) => (ask ? fieldKey(ask) : '')).join(';')

  useEffect(() => watchFields(() => setArrived((count) => count + 1)), [])

  useEffect(() => {
    let current = true
    for (const ask of asks) {
      if (!ask || fieldNow(ask)) continue
      const key = fieldKey(ask)
      loadLandingField(ask).catch((reason: unknown) => {
        console.error(reason)
        failed.current.add(key)
        if (current) setArrived((count) => count + 1)
      })
    }
    return () => {
      current = false
    }
    // `keys` names every ask: the same string is the same work.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [keys])

  return asks.map((ask, slot) => {
    if (!ask) return IDLE
    const own = fieldNow(ask)
    const place = placeKey(ask)
    if (own) {
      last.current.set(slot, { place, answer: own })
      return { answer: own, stale: false, progress: 1, failed: false }
    }
    const before = last.current.get(slot)
    const kept = before?.place === place ? before.answer : null
    return { answer: kept, stale: kept !== null, progress: fieldProgress(ask), failed: failed.current.has(fieldKey(ask)) }
  })
}

/**
 * Each scenario's points read under the mission and the spread (`readField`), or null where there
 * are none yet. `verdicts` holds the verdict for each scenario's aim point itself, which its points
 * are made to agree with. A reading is kept until something it is made from changes, so the page's
 * other redraws cost nothing here.
 */
export function useFieldReadings(fields: FieldState[], mission: SightlineMission, spread: Spread, verdicts: (Miss | null | undefined)[]): (FieldReading | null)[] {
  const kept = useRef<{ from: unknown[]; reading: FieldReading }[]>([])
  return fields.map((state, slot) => {
    if (state.answer?.state !== 'ready') return null
    const from = [state.answer.field, mission.requirements, mission.maxSlopeDeg, spread, verdicts[slot]]
    const before = kept.current[slot]
    if (before?.from.every((value, i) => value === from[i])) return before.reading
    const reading = readField(state.answer.field, mission.requirements, mission.maxSlopeDeg, spread, verdicts[slot])
    kept.current[slot] = { from, reading }
    return reading
  })
}
