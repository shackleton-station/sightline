import { useState } from 'react'
import type { Alternative } from '../lib/slip'
import { type Landing, SLIP_BOUNDS, type SlipCheck as Check } from './monthAnswer'
import { dayUtc, plural, slipWords, whenUtc } from './words'

interface Props {
  check: Check
  landing: Landing
  onDays: (days: number) => void
  /** The landing moved the full number of days, and other sites where a landing then works; null past the data. */
  late: { t: string; works: boolean; others: Alternative[] } | null
  onPlan: (siteId: string | null, t: string) => void
}

/** The main follow-up: if this landing moves later, is there still a window, and what is the next one. */
export function SlipCheck({ check, landing, onDays, late, onPlan }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [min, max] = SLIP_BOUNDS
  const words = slipWords(check, landing)
  const stillWork = check.byDay.filter((works) => works === true).length
  return (
    <section className="pl-slip" aria-labelledby="pl-slip-title">
      <h3 className="pl-label" id="pl-slip-title">
        If the landing slips
      </h3>
      <label className="pl-slip-ask">
        by up to
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? check.days}
          onChange={(event) => {
            const text = event.target.value
            setDraft(text)
            const next = Number(text)
            if (text !== '' && Number.isInteger(next) && next >= min && next <= max) onDays(next)
          }}
          onBlur={() => setDraft(null)}
        />
        days, is there still a landing?
      </label>
      <div role="status">
        <p className={`pl-slip-answer ${words.answer}`}>{words.headline}.</p>
        {words.sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
      {check.landingWorks && (
        <>
          <div className="pl-slip-days" aria-hidden="true">
            {check.byDay.map((works, i) => (
              <span key={i} className={works === null ? 'past' : works ? 'works' : 'none'} title={`${plural(i + 1, 'day')} late`} />
            ))}
          </div>
          <p className="pl-fine">
            One square per whole day of slip, at the same hour: {stillWork} of {check.days} still work.
          </p>
        </>
      )}
      {check.next && !check.holds && (
        <button type="button" className="pl-paper-button" onClick={() => onPlan(null, check.next ? check.next.t : landing.t)}>
          Plan the next landing: {whenUtc(check.next.t)}
        </button>
      )}
      {late && !late.works && late.others.length > 0 && (
        <div className="pl-slip-others">
          <p>
            Other sites where a landing {plural(check.days, 'day')} late, on {dayUtc(late.t)}, works:
          </p>
          <ul>
            {late.others.map(({ site, distanceKm }) => (
              <li key={site.id}>
                <button type="button" className="pl-paper-link" onClick={() => onPlan(site.id, late.t)}>
                  {site.name}
                </button>
                , {Math.round(distanceKm).toLocaleString('en-US')} km away
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
