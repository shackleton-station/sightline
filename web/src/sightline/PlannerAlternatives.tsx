import { useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import type { SiteFlags } from '../lib/flags'
import { hourOf, missionEarth, type Requirements, viableHours } from '../lib/mission'
import { formatDuration } from '../lib/nextChange'
import { entryAt, measureEntry, rankOptions, type ShortlistRow } from '../lib/shortlist'
import { shortReason } from '../lib/sightlineSky'
import { distanceKm } from '../lib/slip'
import type { PlannerSite } from '../planner/plannerModel'
import { whenUtc } from '../planner/words'
import { useWidth } from '../lib/useWidth'

/** How far either side of the chosen date the suggestions may land: about a lunar day's worth, so every site's next good window can show. */
export const AROUND_DAYS = 14
/** How close another site must be to count as "in the same region", when it isn't in the site's own group. */
export const NEARBY_KM = 300
/** At most this many suggestions; one line of them shows until "Show more". */
const MAX_SUGGESTIONS = 8
/** A suggestion card's narrowest width and the gap between them (px), to count how many fit on a line. */
const SUGGESTION_MIN_PX = 172
const SUGGESTION_GAP_PX = 8

/** A landing you kept: one of the screen's scenarios. */
export interface KeptPick {
  letter: string
  site: SiteInfo
  /** The site's hourly flags; null while a custom point is worked out. */
  flags: SiteFlags | null
  /** Its landing, ISO. */
  iso: string
  /** The scenario on show (the one the brief and the Moon are about). */
  onShow: boolean
  onShowIt: () => void
  /** Null when it is the only one: there must always be a scenario. */
  onRemove: (() => void) | null
}

interface Props {
  sites: PlannerSite[]
  requirements: Requirements
  /** Sites steeper than this are left out of the suggestions, and a kept one says it is too steep. */
  maxSlopeDeg: number
  /** The landing on show, ISO, and its site's id. */
  landing: string
  siteId: string
  kept: KeptPick[]
  onOpen: (siteId: string, iso: string) => void
  onKeep: (site: SiteInfo, iso: string) => void
  /** Whether another landing can be kept. */
  room: boolean
}

/** "+2 d 5 h" or "−1 h" from the chosen landing. */
function offsetWords(hours: number): string {
  if (hours === 0) return 'same time'
  const sign = hours > 0 ? '+' : '−'
  return `${sign}${formatDuration(Math.abs(hours))}`
}

type Band = 'both' | 'sun' | 'earth' | 'none'
const BAND: Record<Band, { y: number; height: number }> = { both: { y: 0, height: 10 }, sun: { y: 0, height: 6 }, earth: { y: 4, height: 6 }, none: { y: 4.25, height: 1.5 } }

/** The mission from its landing as one small bar: Sun, Earth (by the mission's rule), both or neither, hour by hour. */
function MiniStrip({ flags, hour, requirements }: { flags: SiteFlags; hour: number; requirements: Requirements }) {
  const runs = useMemo(() => {
    const earth = missionEarth(flags, requirements)
    const hours = Math.min(requirements.missionDays * 24, flags.sun.length - hour)
    const out: { from: number; to: number; band: Band }[] = []
    for (let h = 0; h < hours; h += 1) {
      const s = flags.sun[hour + h] === true
      const e = earth[hour + h] === true
      const band: Band = s && e ? 'both' : s ? 'sun' : e ? 'earth' : 'none'
      const last = out[out.length - 1]
      if (last && last.band === band) last.to = h + 1
      else out.push({ from: h, to: h + 1, band })
    }
    return out
  }, [flags, hour, requirements])
  return (
    <svg className="pl-alt-strip" viewBox={`0 0 ${requirements.missionDays * 24} 10`} preserveAspectRatio="none" aria-hidden="true">
      {runs.map((run) => (
        <rect key={run.from} className={`pl-strip-run is-${run.band}`} x={run.from} y={BAND[run.band].y} width={run.to - run.from} height={BAND[run.band].height} />
      ))}
    </svg>
  )
}

interface Card {
  key: string
  kind: 'kept' | 'suggested'
  row: ShortlistRow
  flags: SiteFlags
  iso: string
  pick?: KeptPick
}

/**
 * Compare landings, as one set of small cards: the ones you kept first (the one on show marked),
 * then suggestions for when the plan has to move: other dates at this site and other sites in the
 * same region (its own group, or within NEARBY_KM), two weeks either side. Suggestions are ranked by
 * the app's shortlist rule (meeting the limits, then the shortest time without Sun, then without
 * Earth; no blended score), nearest the date first among equals. Each card shows the things to watch:
 * whether it fits and why not, the mission hour by hour, and the three figures, past a limit in colour.
 */
export function PlannerAlternatives({ sites, requirements, maxSlopeDeg, landing, siteId, kept, onOpen, onKeep, room }: Props) {
  const cards = useMemo(() => {
    const steep = (site: SiteInfo) => (site.slope && site.slope.deg > maxSlopeDeg ? [`The ground slopes ${site.slope.deg.toFixed(1)}°; your limit is ${maxSlopeDeg}°.`] : [])
    const keptCards: Card[] = kept.flatMap((pick) => {
      if (!pick.flags) return []
      const measured = measureEntry({ site: pick.site.id, at: entryAt(pick.iso) }, pick.site, pick.flags, requirements)
      const [row] = rankOptions([{ ...measured, problems: [...measured.problems, ...steep(pick.site)] }])
      return [{ key: `kept-${pick.letter}`, kind: 'kept' as const, row, flags: pick.flags, iso: pick.iso, pick }]
    })
    // A suggestion in the same landing window as a kept one (the same unbroken run of landing hours) would only repeat it.
    const keptHours = (siteKey: string, flagsStart: string) => kept.filter((pick) => pick.site.id === siteKey).map((pick) => hourOf(flagsStart, pick.iso))

    const around = AROUND_DAYS * 24
    const here = sites.find((one) => one.site.id === siteId)?.site
    const nearby = (site: SiteInfo) => !here || site.id === here.id || site.group === here.group || distanceKm(site, here) <= NEARBY_KM
    const flagsOf = new Map(sites.map((one) => [one.site.id, one.flags]))
    const picks = sites.flatMap(({ site, flags }) => {
      if (!nearby(site) || steep(site).length > 0) return []
      const at = hourOf(flags.start, landing)
      const viable = viableHours(flags.sun, missionEarth(flags, requirements), requirements)
      const iso = (h: number) => new Date(Date.parse(flags.start) + h * 3_600_000).toISOString().replace('.000Z', 'Z')
      const taken = new Set<number>()
      for (const k of keptHours(site.id, flags.start)) {
        taken.add(k)
        for (let h = k - 1; h >= 0 && viable[h] === 1; h -= 1) taken.add(h)
        for (let h = k + 1; h < viable.length && viable[h] === 1; h += 1) taken.add(h)
      }
      const candidates: number[] = []
      for (let h = Math.max(0, at - around); h < Math.min(viable.length, at + around + 1); h += 1) {
        if (viable[h] === 1 && !taken.has(h)) candidates.push(h)
      }
      if (candidates.length === 0) return []
      const measured = candidates.map((h) => measureEntry({ site: site.id, at: entryAt(iso(h)) }, site, flags, requirements))
      // This site's best by the rule; among options it can't separate, the one nearest the chosen date.
      const ranked = rankOptions(measured)
      const best = ranked
        .filter((row) => row.rank === ranked[0].rank)
        .sort((a, b) => Math.abs(hourOf(flags.start, `${a.entry.at}:00:00Z`) - at) - Math.abs(hourOf(flags.start, `${b.entry.at}:00:00Z`) - at))[0]
      return [measured.find((row) => row.entry.at === best.entry.at) ?? measured[0]]
    })
    const away = (row: ShortlistRow) => Math.abs(Date.parse(`${row.entry.at}:00:00Z`) - Date.parse(landing))
    const suggested: Card[] = rankOptions(picks)
      .sort((a, b) => a.rank - b.rank || away(a) - away(b))
      .slice(0, MAX_SUGGESTIONS)
      .flatMap((row) => {
        const flags = flagsOf.get(row.site.id)
        return flags ? [{ key: `sug-${row.site.id}@${row.entry.at}`, kind: 'suggested' as const, row, flags, iso: `${row.entry.at}:00:00Z` }] : []
      })
    return [...keptCards, ...suggested]
  }, [sites, requirements, maxSlopeDeg, landing, siteId, kept])

  const chosenMs = Date.parse(landing)
  const date = whenUtc(landing).replace(/, \d\d:\d\d UTC$/, '')
  const picks = cards.filter((card) => card.kind === 'kept')
  const suggestions = cards.filter((card) => card.kind === 'suggested')
  // One line of suggestions, as many as fit; the rest behind "Show more".
  const [lineRef, lineWidth] = useWidth()
  const [more, setMore] = useState(false)
  const perLine = Math.max(1, Math.floor((lineWidth + SUGGESTION_GAP_PX) / (SUGGESTION_MIN_PX + SUGGESTION_GAP_PX)))
  const shownSuggestions = more ? suggestions : suggestions.slice(0, perLine)

  const figures = (row: ShortlistRow) => ({
    darkOver: row.sunGapH !== null && row.sunGapH > requirements.maxSunGapH,
    silenceOver: row.earthGapH !== null && row.earthGapH > requirements.maxEarthGapH,
  })

  return (
    <section className="pl-alts" aria-labelledby="pl-alts-title">
      <h3 className="pl-label" id="pl-alts-title">
        Your picks
      </h3>
      <ol className="pl-alts-list">
        {picks.map((card) => {
          const { row } = card
          const fits = row.problems.length === 0
          const offset = Math.round((Date.parse(card.iso) - chosenMs) / 3_600_000)
          const { darkOver, silenceOver } = figures(row)
          return (
            <li key={card.key} className={['pl-alt', 'is-kept', card.pick?.onShow ? 'is-on-show' : '', fits ? 'fits' : 'misses'].join(' ')}>
              <p className="pl-alt-tag">
                <span className="pl-alt-letter">{card.pick?.letter}</span> {card.pick?.onShow ? 'On show' : 'Kept'}
                <span className={`pl-alt-fit ${fits ? 'fits' : 'misses'}`}>{fits ? '✓ Fits' : '✗ Misses'}</span>
              </p>
              <p className="pl-alt-site">{row.site.name}</p>
              <p className="pl-alt-when">
                {whenUtc(card.iso).replace(' UTC', '')} {card.pick?.onShow ? null : <span>{offsetWords(offset)}</span>}
              </p>
              <MiniStrip flags={card.flags} hour={hourOf(card.flags.start, card.iso)} requirements={requirements} />
              <dl className="pl-alt-figures">
                <div>
                  <dt>Sunlit</dt>
                  <dd>{row.sunPct === null ? '–' : `${Math.round(row.sunPct)}%`}</dd>
                </div>
                <div className={darkOver ? 'is-over' : undefined}>
                  <dt>Dark</dt>
                  <dd>{row.sunGapH === null ? '–' : formatDuration(row.sunGapH)}</dd>
                </div>
                <div className={silenceOver ? 'is-over' : undefined}>
                  <dt>Silence</dt>
                  <dd>{row.earthGapH === null ? '–' : formatDuration(row.earthGapH)}</dd>
                </div>
              </dl>
              {!fits && <p className="pl-alt-why">{row.problems.map(shortReason).join(' · ')}</p>}
              <p className="pl-alt-actions">
                {!card.pick?.onShow && (
                  <button type="button" className="pl-button primary" onClick={card.pick?.onShowIt}>
                    Show
                  </button>
                )}
                {card.pick?.onRemove && (
                  <button type="button" className="pl-button" onClick={card.pick.onRemove}>
                    Remove
                  </button>
                )}
              </p>
            </li>
          )
        })}
      </ol>

      <div className="pl-sugs-head">
        <h4 className="pl-label">If the plan has to move</h4>
        <span className="pl-alts-sub">This site and nearby, within two weeks of {date}: best first by time without Sun, then without Earth.</span>
      </div>
      {suggestions.length === 0 ? (
        <p className="pl-alts-none">Nothing here or nearby has another landing within two weeks either side that meets your limits. The grid shows when one does.</p>
      ) : (
        <ol className="pl-sugs" ref={lineRef} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${SUGGESTION_MIN_PX}px, 1fr))`, gap: `${SUGGESTION_GAP_PX}px` }}>
          {shownSuggestions.map((card) => {
            const { row } = card
            const offset = Math.round((Date.parse(card.iso) - chosenMs) / 3_600_000)
            const { darkOver, silenceOver } = figures(row)
            return (
              <li key={card.key} className="pl-sug">
                <p className="pl-sug-top">
                  <span className="pl-sug-rank">#{row.rank}</span>
                  <span className="pl-sug-site">{row.site.name}</span>
                </p>
                <p className="pl-sug-when">
                  {whenUtc(card.iso).replace(/ \d{4}, /, ', ').replace(' UTC', '')} <span>{offsetWords(offset)}</span>
                </p>
                <MiniStrip flags={card.flags} hour={hourOf(card.flags.start, card.iso)} requirements={requirements} />
                <p className="pl-sug-figs">
                  <span>{row.sunPct === null ? '–' : `${Math.round(row.sunPct)}%`} sun</span>
                  <span className={darkOver ? 'is-over' : undefined}>{row.sunGapH === null ? '–' : formatDuration(row.sunGapH)} dark</span>
                  <span className={silenceOver ? 'is-over' : undefined}>{row.earthGapH === null ? '–' : formatDuration(row.earthGapH)} silent</span>
                </p>
                <p className="pl-sug-actions">
                  <button type="button" title="Move the landing on show here" onClick={() => onOpen(row.site.id, card.iso)}>
                    Open
                  </button>
                  <button type="button" disabled={!room} title={room ? 'Keep it as a pick' : 'Four picks at most: remove one first'} onClick={() => onKeep(row.site, card.iso)}>
                    Keep
                  </button>
                </p>
              </li>
            )
          })}
        </ol>
      )}
      {suggestions.length > perLine && (
        <button type="button" className="pl-sugs-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? 'Show fewer' : `Show ${suggestions.length - perLine} more`}
        </button>
      )}
      <p className="pl-alts-key">
        <i className="pl-strip-key is-sun" /> Sun <i className="pl-strip-key is-earth" /> Earth <i className="pl-strip-key is-both" /> Both <i className="pl-strip-key is-none" /> Neither, over the {requirements.missionDays}-day mission. Orange: past your limit.
      </p>
    </section>
  )
}
