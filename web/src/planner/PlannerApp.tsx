import { OLD_HOME } from '../lib/siteTabs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SharePlan } from '../components/SharePlan'
import { SiteTabs } from '../components/SiteTabs'
import { setAddressBar } from '../lib/address'
import { hourOf, locateHour, type Requirements } from '../lib/mission'
import { addEntries, entryAt, sameEntry, type ShortlistEntry, toIso } from '../lib/shortlist'
import { SLIPS } from '../lib/slip'
import { EXAMPLE_REQUIREMENTS } from '../state/viewStore'
import { defaultAddress, readAddress } from './address'
import { Brief } from './Brief'
import { LandingSky } from './LandingSky'
import { MissionBar } from './MissionBar'
import { NothingWorks } from './NothingWorks'
import { PlannerHead, PlannerLoading, PlannerProblem } from './PlannerStates'
import { ShortList } from './ShortList'
import { SlipCheck } from './SlipCheck'
import { usePlannerData } from './usePlannerData'
import { type Plan, usePlannerView } from './usePlannerView'
import { briefWhy } from './why'
import { whenUtc } from './words'
import { WindowGrid } from './WindowGrid'

const FALLBACK = defaultAddress(EXAMPLE_REQUIREMENTS)
/** The slip first asked about: the app's shortest listed delay, a week. */
const FIRST_SLIP_DAYS = SLIPS[0].days ?? 7

/** A link's choice. With no link, the default site and month, at whatever its best landing turns out to be. */
function planFrom(hash: string): Plan {
  return readAddress(hash, EXAMPLE_REQUIREMENTS) ?? { ...FALLBACK, month: null, index: null }
}

/**
 * The Planner: the decision first, with no globe. Describe the mission, see every site against
 * every month, choose a square and read the answer as a brief.
 */
export function PlannerApp() {
  const data = usePlannerData()
  const [arrivedAt] = useState(() => window.location.hash)
  const [plan, setPlan] = useState<Plan>(() => planFrom(window.location.hash))
  const [slipDays, setSlipDays] = useState(FIRST_SLIP_DAYS)
  /** The link that was last copied, so "Link copied" goes away as soon as the view changes. */
  const [copiedHash, setCopiedHash] = useState<string | null>(null)
  const sites = data.status === 'ready' ? data.sites : null
  const view = usePlannerView(sites, plan, FALLBACK, slipDays)
  const hash = view?.hash ?? ''

  // The address always reopens what is on screen, in the app's own encoding.
  useEffect(() => {
    if (hash && window.location.hash !== hash) setAddressBar(hash)
  }, [hash])
  // A link pasted into the open tab: go where it points. The page's own rewrites don't fire this.
  useEffect(() => {
    const onHashChange = () => setPlan(planFrom(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // With nothing chosen, the page opens on the first month that has a landing. Changing a limit
  // makes the month on screen the choice, so the selection doesn't jump as the grid redraws.
  const shownMonth = view?.month ?? null
  const why = useMemo(() => (view ? briefWhy(view.row.flags, view.answer.span, view.viable, view.answer.days, plan.requirements) : null), [view, plan.requirements])
  const setLimits = (requirements: Requirements) => setPlan((now) => ({ ...now, month: now.month ?? shownMonth, requirements }))
  const pick = useCallback((site: string, month: string) => setPlan((now) => ({ ...now, site, month, index: null })), [])
  /**
   * A square chosen with the pointer: if the brief isn't in sight (under the grid on narrower
   * windows), bring it up so the click visibly answers. Keyboard choices stay put, on the grid.
   */
  const answerRef = useRef<HTMLDivElement>(null)
  const [reveal, setReveal] = useState(0)
  const pickAndShow = useCallback(
    (site: string, month: string, byPointer: boolean) => {
      pick(site, month)
      if (byPointer) setReveal((count) => count + 1)
    },
    [pick],
  )
  useEffect(() => {
    const box = answerRef.current
    if (!reveal || !box) return
    const top = box.getBoundingClientRect().top
    if (top > 0 && top < window.innerHeight * 0.6) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  }, [reveal])
  const listed = useMemo(() => new Set(plan.shortlist.map((entry) => `${entry.site}@${entry.at.slice(0, 7)}`)), [plan.shortlist])

  if (data.status !== 'ready' || !view || !sites) {
    return (
      <div className="planner">
        <SiteTabs current="planner" view={window.location.hash} />
        <main className="pl-page">
          <PlannerHead tally={null} />
          <MissionBar value={plan.requirements} example={EXAMPLE_REQUIREMENTS} onChange={setLimits} />
          {data.status === 'error' ? <PlannerProblem onRetry={data.retry} /> : <PlannerLoading />}
        </main>
      </div>
    )
  }

  const { row, month, answer, landing, viable } = view
  const start = row.flags.start
  const current: ShortlistEntry = { site: row.site.id, at: entryAt(landing.t) }
  const kept = plan.shortlist.some((entry) => sameEntry(entry, current))
  /** Plan a landing at a time, here or at another site. */
  const planAt = (site: string | null, t: string) => {
    const place = locateHour(start, hourOf(start, t))
    setPlan((now) => ({ ...now, site: site ?? row.site.id, month: place.month, index: place.index }))
  }
  /** Plan the landing on a day of the month: its first landing hour that works, or midnight if none does. */
  const planDay = (day: number) => {
    const first = Array.from({ length: 24 }, (_, h) => day * 24 + h).find((index) => viable[answer.span.from + index] === 1)
    setPlan((now) => ({ ...now, site: row.site.id, month, index: first ?? day * 24 }))
  }
  const link = `${window.location.origin}${window.location.pathname}${hash}`

  return (
    <div className="planner">
      <SiteTabs current="planner" view={hash} />
      <main className="pl-page">
        <PlannerHead tally={view.grid.tally} sites={view.grid.rows.length} />
        <MissionBar value={plan.requirements} example={EXAMPLE_REQUIREMENTS} onChange={setLimits} />
        {view.substituted && (
          <p className="pl-notice" role="status">
            This link names a place or month the Planner doesn't list, so it shows {row.site.name} instead. <a href={`${OLD_HOME}${arrivedAt}`}>Open the link in Classic</a>.
          </p>
        )}
        {view.grid.tally.withLanding === 0 && <NothingWorks sites={sites} requirements={plan.requirements} onChange={setLimits} />}
        <div className="pl-body">
          <WindowGrid grid={view.grid} siteId={row.site.id} month={month} listed={listed} onPick={pickAndShow} />
          <div className="pl-answer" ref={answerRef}>
            <Brief
              site={row.site}
              month={month}
              requirements={plan.requirements}
              start={start}
              answer={answer}
              landing={landing}
              others={view.others}
              obsHeightM={data.obsHeightM}
              link={link}
              kept={kept}
              onKeep={() => setPlan((now) => ({ ...now, shortlist: addEntries(now.shortlist, [current]) }))}
              onDay={planDay}
              onUseBest={() => setPlan((now) => ({ ...now, site: row.site.id, month, index: null }))}
              onPick={pick}
              sky={<LandingSky site={row.site} flags={row.flags} t={landing.t} requirements={plan.requirements} />}
              why={why}
            >
              <SlipCheck check={view.check} landing={landing} onDays={setSlipDays} late={view.late} onPlan={planAt} />
            </Brief>
            <div className="pl-take" role="group" aria-label="Take this answer away">
              <button type="button" className="pl-button primary" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopiedHash(hash), () => setCopiedHash(null))}>
                {copiedHash === hash ? 'Link copied' : 'Copy the link'}
              </button>
              <SharePlan view={hash} suggestedTitle={`${row.site.name}, ${whenUtc(landing.t)}`} />
              <button type="button" className="pl-button" onClick={() => window.print()}>
                Print the brief
              </button>
            </div>
          </div>
          <ShortList
            sites={sites}
            list={plan.shortlist}
            current={current}
            requirements={plan.requirements}
            onOpen={(entry) => planAt(entry.site, toIso(entry.at))}
            onRemove={(entry) => setPlan((now) => ({ ...now, shortlist: now.shortlist.filter((other) => !sameEntry(other, entry)) }))}
            onClear={() => setPlan((now) => ({ ...now, shortlist: [] }))}
          />
        </div>
        <p className="pl-foot">
          By team Shackleton Station. Every number comes from the same pipeline as the other tabs: NASA LOLA terrain and SPICE ephemeris, hour by hour, {view.grid.months[0].slice(0, 4)} to {view.grid.months[view.grid.months.length - 1].slice(0, 4)}. <a href={`${OLD_HOME}#how`}>How it works</a>
        </p>
      </main>
    </div>
  )
}
