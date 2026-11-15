import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FlaggedSite } from '../data/useAllFlags'
import { cardsOf, type LibraryCard, type LibraryEntry, planEntries } from '../lib/library'
import { SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { buildGrid } from '../planner/plannerModel'
import { loadLibrary } from '../lib/plans'

/** The library as the Planner holds it: being read, read, not offered by this site, or not reached. */
export type LibraryState = { kind: 'loading' } | { kind: 'ready'; entries: LibraryEntry[] } | { kind: 'none' } | { kind: 'failed'; message: string }

/**
 * The library, read from the plans service the first time it is wanted and again on `reload`.
 * `wanted` is false until the Library tab or the tray is first opened, so a visit that never looks
 * at the library never asks for it.
 */
export function useLibrary(wanted: boolean): { state: LibraryState; reload: () => void } {
  const [state, setState] = useState<LibraryState>({ kind: 'loading' })
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    if (!wanted) return
    let current = true
    setState({ kind: 'loading' })
    void loadLibrary().then((result) => {
      if (!current) return
      if (!result.ok) setState({ kind: 'failed', message: result.message })
      else setState(result.value === null ? { kind: 'none' } : { kind: 'ready', entries: result.value })
    })
    return () => {
      current = false
    }
  }, [wanted, asked])
  return { state, reload: useCallback(() => setAsked((n) => n + 1), []) }
}

interface LibraryCardsInput {
  /** False until the library or the tray is first looked at: nothing is read or worked out before. */
  wanted: boolean
  start: string
  hours: number
  flagged: FlaggedSite[]
  mission: SightlineMission
  scenarios: SightlineScenario[]
}

/**
 * The library and the tray as cards, measured against the mission on screen. The tray is the plan
 * itself: its scenarios, A to D, in their order, so a landing added from the library is on the main
 * screen with the others and nothing is kept anywhere else. The month grid gives each card the share of its month's days
 * with a landing that fits; it is built only once the library is wanted.
 */
export function useLibraryCards({ wanted, start, hours, flagged, mission, scenarios }: LibraryCardsInput) {
  const { state, reload } = useLibrary(wanted)
  const grid = useMemo(() => (wanted ? buildGrid(flagged, mission.requirements) : null), [wanted, flagged, mission.requirements])
  const monthShare = useCallback((siteId: string, month: string) => grid?.rows.find((row) => row.site.id === siteId)?.cells.find((cell) => cell.month === month)?.share ?? null, [grid])
  const cards = useMemo(() => (state.kind === 'ready' ? cardsOf(state.entries, start, hours, flagged, mission, monthShare) : []), [state, start, hours, flagged, mission, monthShare])
  /** The plan's scenarios as cards: the card at index i is scenario i. */
  const planCards = useMemo(() => cardsOf(planEntries(scenarios, start), start, hours, flagged, mission, monthShare), [scenarios, start, hours, flagged, mission, monthShare])
  /** The letter a card's scenario has in the plan, or null when it is not there. */
  const letterOf = (card: LibraryCard) => {
    const i = scenarios.findIndex((scenario) => scenario.site === card.scenario?.site && scenario.landing === card.scenario.landing)
    return i < 0 ? null : SCENARIO_LETTERS[i]
  }
  /** Where a card's scenario is in the plan, or -1. */
  const indexOf = (card: LibraryCard) => scenarios.findIndex((scenario) => scenario.site === card.scenario?.site && scenario.landing === card.scenario.landing)
  return { state, reload, cards, planCards, letterOf, indexOf }
}
