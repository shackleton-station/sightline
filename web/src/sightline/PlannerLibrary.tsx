import { useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { filterCards, filtering, type LibraryCard, type LibraryFilters, NO_FILTERS } from '../lib/library'
import { LibraryCardView } from './LibraryCard'
import type { LibraryState } from './useLibrary'

interface Props {
  start: string
  /** The library as read; the cards are its entries measured against the mission on screen. */
  state: LibraryState
  cards: LibraryCard[]
  /** The listed sites, for the place filter. */
  sites: SiteInfo[]
  /** The first and last month of the data, as "2026-01", for the two month fields. */
  firstMonth: string
  lastMonth: string
  /** Add a card's landing to the plan as its next scenario, staying here so more can be added. */
  onAdd: (card: LibraryCard) => void
  /** Take a card's landing out of the plan again. */
  onRemove: (card: LibraryCard) => void
  /** Whether a scenario can be taken out: the plan always keeps one. */
  canRemove: boolean
  /** Put a card's landing in the plan and show it there: the plan column at the top left of the main screen. */
  onShow: (card: LibraryCard) => void
  /** The letter a card's landing has in the plan already, or null. */
  letterOf: (card: LibraryCard) => string | null
  /** Whether the plan has room for one more scenario. */
  room: boolean
  onReload: () => void
  /** Open the saved plan a landing came from, as its link would. */
  onOpenPlan: (id: string) => void
}

/** How much of a month must have a day that fits: the stops of the last filter, in percent. */
const MONTH_STOPS = [0, 10, 25, 50, 75]

/**
 * The Library's list: every scenario in the plans people have saved, to search and filter. "Add to
 * plan" makes a card's landing the plan's next scenario (C after A and B), where the main screen,
 * Compare and the letters at the top all show it; pressed again, it takes it out. Whether a card fits is
 * judged against the mission on screen, not the one it was saved with.
 */
export function PlannerLibrary({ start, state, cards, sites, firstMonth, lastMonth, onAdd, onRemove, canRemove, onShow, letterOf, room, onReload, onOpenPlan }: Props) {
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS)
  const set = (change: Partial<LibraryFilters>) => setFilters((before) => ({ ...before, ...change }))
  const shown = useMemo(() => filterCards(cards, filters), [cards, filters])

  if (state.kind === 'loading') return <p className="sl-quiet" role="tabpanel" aria-label="Library">Reading the library…</p>
  if (state.kind === 'none' || state.kind === 'failed') {
    return (
      <div className="lib-empty" role="tabpanel" aria-label="Library">
        <h3>{state.kind === 'none' ? 'No library here yet' : 'The library could not be read'}</h3>
        <p>{state.kind === 'none' ? 'Saved plans are not switched on for this site, so there is nothing to search.' : state.message}</p>
        {state.kind === 'failed' && (
          <button type="button" className="sl-small" onClick={onReload}>
            Try again
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="lib" role="tabpanel" aria-label="Library">
      <form className="lib-filters" role="search" aria-label="Search the library" onSubmit={(event) => event.preventDefault()}>
        <label className="lib-words">
          <span>Search</span>
          <input type="search" value={filters.words} placeholder="A plan’s name or a place" onChange={(event) => set({ words: event.target.value })} />
        </label>
        <label>
          <span>Place</span>
          <select value={filters.site} onChange={(event) => set({ site: event.target.value })}>
            <option value="">Every place</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Landing from</span>
          <input type="month" value={filters.from} min={firstMonth} max={lastMonth} onChange={(event) => set({ from: event.target.value })} />
        </label>
        <label>
          <span>to</span>
          <input type="month" value={filters.to} min={firstMonth} max={lastMonth} onChange={(event) => set({ to: event.target.value })} />
        </label>
        <label title="Of the days in the landing’s month, at that site, how many have a landing that fits your mission">
          <span>Days that fit in its month</span>
          <select value={filters.minMonthPct} onChange={(event) => set({ minMonthPct: Number(event.target.value) })}>
            {MONTH_STOPS.map((stop) => (
              <option key={stop} value={stop}>
                {stop === 0 ? 'Any' : `At least ${stop}%`}
              </option>
            ))}
          </select>
        </label>
        <label className="lib-check">
          <input type="checkbox" checked={filters.fitsOnly} onChange={(event) => set({ fitsOnly: event.target.checked })} />
          <span>Fits my mission</span>
        </label>
        <label className="lib-check" title="The same place and hour saved in several plans is shown once, from the newest of them">
          <input type="checkbox" checked={filters.oneEach} onChange={(event) => set({ oneEach: event.target.checked })} />
          <span>One card per landing</span>
        </label>
        {filtering(filters) && (
          <button type="button" className="sl-small" onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </button>
        )}
      </form>
      <p className="lib-count" aria-live="polite">
        {cards.length === 0 ? 'Nobody has saved a plan yet. Save one from Share and it appears here.' : `${shown.length} shown of ${cards.length} saved landings, judged against your mission.`}
        <button type="button" className="lib-reload" onClick={onReload}>
          Read again
        </button>
      </p>
      {cards.length > 0 && shown.length === 0 && <p className="sl-quiet">Nothing matches. Loosen a filter, or clear them all.</p>}
      <ul className="lib-grid">
        {shown.map((card) => {
          const letter = letterOf(card)
          return (
            <li key={card.key}>
              <LibraryCardView card={card} start={start}>
                <button
                  type="button"
                  className="sl-small lib-pull"
                  aria-pressed={letter !== null}
                  disabled={!card.scenario || (letter === null ? !room : !canRemove)}
                  title={letter ? (canRemove ? `Scenario ${letter} of your plan. Press to take it out again` : `Scenario ${letter}, the only one in your plan`) : room ? 'Adds this landing to your plan as its next scenario' : 'The plan holds four scenarios: remove one first'}
                  onClick={() => (letter === null ? onAdd(card) : onRemove(card))}
                >
                  {letter ? `✓ In plan · ${letter}` : room ? 'Add to plan' : 'Plan is full'}
                </button>
                <button
                  type="button"
                  className="sl-small"
                  disabled={!card.scenario || (letter === null && !room)}
                  title={letter ? `Goes to the main screen with scenario ${letter} on show` : room ? 'Adds this landing to your plan and goes to the main screen with it on show' : 'The plan holds four scenarios: remove one first'}
                  onClick={() => onShow(card)}
                >
                  Show in plan
                </button>
                <button type="button" className="lib-open" title="Opens the whole saved plan this landing came from" onClick={() => onOpenPlan(card.entry.plan)}>
                  Open plan
                </button>
              </LibraryCardView>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
