import { useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { filterCards, filtering, inTray, type LibraryCard, type LibraryEntry, type LibraryFilters, MAX_TRAY, NO_FILTERS } from '../lib/library'
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
  tray: LibraryEntry[]
  onToggle: (entry: LibraryEntry) => void
  onReload: () => void
}

/** How much of a month must have a day that fits: the stops of the last filter, in percent. */
const MONTH_STOPS = [0, 10, 25, 50, 75]

/**
 * The Library: every scenario in the plans people have saved, to search and filter. A card pulled
 * in goes to the tray (the lander at the top), and from there into Compare. Whether a card fits is
 * judged against the mission on screen, not the one it was saved with.
 */
export function PlannerLibrary({ start, state, cards, sites, firstMonth, lastMonth, tray, onToggle, onReload }: Props) {
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS)
  const set = (change: Partial<LibraryFilters>) => setFilters((before) => ({ ...before, ...change }))
  const shown = useMemo(() => filterCards(cards, filters), [cards, filters])
  const full = tray.length >= MAX_TRAY

  if (state.kind === 'loading') return <p className="sl-quiet" role="tabpanel" aria-label="Library">Reading the library…</p>
  if (state.kind === 'none' || state.kind === 'failed') {
    return (
      <div className="np-compare-empty" role="tabpanel" aria-label="Library">
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
        {filtering(filters) && (
          <button type="button" className="sl-small" onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </button>
        )}
      </form>
      <p className="lib-count" aria-live="polite">
        {cards.length === 0 ? 'Nobody has saved a plan yet. Save one from Share and it appears here.' : `${shown.length} of ${cards.length} saved landings, judged against the mission on the left.`}
        <button type="button" className="lib-reload" onClick={onReload}>
          Read again
        </button>
      </p>
      {cards.length > 0 && shown.length === 0 && <p className="sl-quiet">Nothing matches. Loosen a filter, or clear them all.</p>}
      <ul className="lib-grid">
        {shown.map((card) => {
          const kept = inTray(tray, card.entry)
          return (
            <li key={card.key}>
              <LibraryCardView card={card} start={start}>
                <button type="button" className="sl-small lib-pull" aria-pressed={kept} disabled={!card.scenario || (!kept && full)} title={kept ? 'Take it out of the tray' : full ? `The tray holds ${MAX_TRAY}` : 'Put it in the tray, to compare'} onClick={() => onToggle(card.entry)}>
                  {kept ? '✓ In the tray' : 'Pull in'}
                </button>
                <a className="lib-open" href={`#plan=${card.entry.plan}`} title="Opens the saved plan this landing came from">
                  Open plan
                </a>
              </LibraryCardView>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
