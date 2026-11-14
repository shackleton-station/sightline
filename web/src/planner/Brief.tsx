import type { ReactNode } from 'react'
import type { SiteInfo } from '../data/contract'
import type { Requirements } from '../lib/mission'
import { monthLabel } from '../lib/months'
import type { Landing, MonthAnswer } from './monthAnswer'
import { DayStrip } from './DayStrip'
import type { OtherSite } from './plannerModel'
import { landingWords, missionFacts, missionWords, placeWords, plural, verdictWords, whenUtc, windowWords } from './words'

interface Props {
  site: SiteInfo
  month: string
  requirements: Requirements
  /** When the data starts, to turn hour counts into dates. */
  start: string
  answer: MonthAnswer
  /** The landing being planned: the best one, or the day the planner chose. */
  landing: Landing
  /** Other sites with a landing this month, nearest first. Shown when this site has none. */
  others: OtherSite[]
  obsHeightM: number
  /** The full link to this view, printed on the brief. */
  link: string
  /** Whether this landing is already on the short list. */
  kept: boolean
  onKeep: () => void
  /** The keep button's words, before and after; the Planner page's short list by default. */
  keepWords?: { keep: string; kept: string }
  onDay: (day: number) => void
  onUseBest: () => void
  onPick: (siteId: string, month: string) => void
  /** What the sky does from the landing on: sunset, Earthset and the Sun's height. */
  sky: ReactNode
  /** Why the month's other days have no landing, in a sentence; null when every day works. */
  why?: string | null
  /** The slip check, which needs every site's data and so is put together by the page. */
  children: ReactNode
}

const STAMP = { works: 'Works', tight: 'Tight', none: 'No landing' }

/**
 * The answer for the chosen site and month, written as a one-page brief: sentences first, numbers
 * second. It is the same sheet on screen and on paper.
 */
export function Brief({ site, month, requirements, start, answer, landing, others, obsHeightM, link, kept, onKeep, onDay, onUseBest, onPick, sky, why = null, keepWords = { keep: 'Keep this option', kept: 'On the short list' }, children }: Props) {
  const verdict = verdictWords(site.name, month, requirements, answer)
  const works = landing.problems.length === 0
  const isBest = landing.hour === answer.best.hour
  const dayOf = (hour: number) => Math.floor((hour - answer.span.from) / 24)
  const facts = missionFacts(landing, requirements)
  const said = landingWords(isBest, answer.days, monthLabel(month))
  return (
    <article className={`pl-brief ${verdict.status}`} id="brief" aria-labelledby="pl-brief-title">
      <header className="pl-brief-head">
        <p className="pl-label">Landing brief</p>
        <p className="pl-stamp">{STAMP[verdict.status]}</p>
        <h2 id="pl-brief-title">
          {site.name}, {monthLabel(month)}
        </h2>
        <p className="pl-fine">
          {placeWords(site.lat, site.lon)} · {site.group}
        </p>
      </header>

      <section className="pl-verdict" role="status">
        <p className="pl-verdict-headline">{verdict.headline}</p>
        <p>{verdict.sentence}</p>
        {why && verdict.status !== 'works' && (
          <p className="pl-why">
            <strong>Why:</strong> {why}
          </p>
        )}
      </section>

      <section aria-labelledby="pl-days-title">
        <h3 className="pl-label" id="pl-days-title">
          Landing days, {monthLabel(month)} (UTC)
        </h3>
        <DayStrip month={month} answer={answer} plannedDay={dayOf(landing.hour)} bestDay={answer.days > 0 ? dayOf(answer.best.hour) : null} onDay={onDay} />
        {answer.windows.length > 0 && (
          <ul className="pl-windows">
            {answer.windows.map((window) => (
              <li key={window.from}>{windowWords(start, window)}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pl-landing-title">
        <h3 className="pl-label" id="pl-landing-title">
          {said.heading}
        </h3>
        {said.note && <p className="pl-fine">{said.note}</p>}
        <div className="pl-landing-row">
          <p className="pl-when">{whenUtc(landing.t)}</p>
          <button type="button" className="pl-paper-button" disabled={kept} onClick={onKeep}>
            {kept ? keepWords.kept : keepWords.keep}
          </button>
        </div>
        {works ? (
          <p>{facts.join(' ')}</p>
        ) : (
          <>
            <p>A landing then misses your limits:</p>
            <ul className="pl-problems">
              {landing.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </>
        )}
        {!isBest && (
          <button type="button" className="pl-paper-button" onClick={onUseBest}>
            {said.back}: {whenUtc(answer.best.t)}
          </button>
        )}
      </section>

      {sky}

      {children}

      {answer.days === 0 && others.length > 0 && (
        <section aria-labelledby="pl-others-title">
          <h3 className="pl-label" id="pl-others-title">
            Sites that do work in {monthLabel(month)}, nearest first
          </h3>
          <ul className="pl-others">
            {others.map((other) => (
              <li key={other.site.id}>
                <button type="button" className="pl-paper-link" onClick={() => onPick(other.site.id, month)}>
                  {other.site.name}
                </button>
                : {plural(other.days, 'landing day')}, {Math.round(other.distanceKm).toLocaleString('en-US')} km away
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="pl-brief-foot">
        <p>
          <strong>Worked out for:</strong> {missionWords(requirements)}
        </p>
        <p>
          From hourly model data for a point {obsHeightM} m above the ground, so every time here is good to the hour, not the minute. A landing day is a UTC day with at least one landing hour that works. Best means the landing whose longest stretch without the Sun is shortest, then without Earth, as far as hourly data can tell landings apart, then the one with the most room to slip. There is no combined score. This is a first pass for narrowing down sites and dates, not a mission design.
        </p>
        <p className="pl-print-only">
          Shackleton Station. A hackathon project: do not use it for real mission decisions. Reopen this brief: <span className="pl-brief-link">{link}</span>
        </p>
      </footer>
    </article>
  )
}
