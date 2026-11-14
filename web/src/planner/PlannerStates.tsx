import type { Tally } from './plannerModel'

/** The page's title and, once the data is in, how much of the grid has a landing for this mission. */
export function PlannerHead({ tally }: { tally: Tally | null }) {
  return (
    <header className="pl-head">
      <div>
        <p className="pl-label">Planner</p>
        <h1>Where and when can this mission land?</h1>
      </div>
      {tally && (
        <p className="pl-tally" aria-live="polite">
          <strong className={tally.withLanding === 0 ? 'none' : undefined}>{tally.withLanding}</strong>
          <span>
            of {tally.total} site-and-month squares have a landing that survives the mission
            {tally.tight > 0 ? `; ${tally.tight} of those are tight` : ''}.
          </span>
        </p>
      )}
    </header>
  )
}

/** The grid's outline while the data loads, so the page keeps its shape. */
export function PlannerLoading() {
  return (
    <div className="pl-loading" role="status">
      <p>Reading every site and month…</p>
      <div className="pl-loading-rows" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
    </div>
  )
}

export function PlannerProblem({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="pl-problem" role="alert">
      <h2>The site data didn't load.</h2>
      <p>Nothing is shown rather than something out of date. Check your connection, then try again.</p>
      <button type="button" className="pl-button primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
