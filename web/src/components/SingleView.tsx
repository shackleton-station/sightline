import { useEffect, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { CUSTOM_GROUP, customSiteInfo } from '../data/customSite'
import { useSiteFlagsState } from '../data/useSiteFlags'
import type { ScenarioData } from '../data/loadSite'
import { explainerTitle } from '../lib/explainer'
import { locateHour, type Requirements } from '../lib/mission'
import type { Mode } from '../lib/mode'
import { monthLabel } from '../lib/months'
import { nearbyAnchor } from '../lib/nearby'
import { locateDate, panelSunlight } from '../lib/power'
import type { Scenario } from '../lib/scenario'
import { addEntries, entryAt, type ShortlistEntry } from '../lib/shortlist'
import { BOTH_UP } from '../lib/slip'
import { meanSunElevationUp } from '../lib/compare'
import { AnswerCard } from './AnswerCard'
import { DateField } from './DateField'
import { DownloadCsv } from './DownloadCsv'
import { EarthVsMoon } from './EarthVsMoon'
import { Explainer } from './Explainer'
import { MastHeights } from './MastHeights'
import { HeroView } from './HeroView'
import { LandingGrid } from './LandingGrid'
import { MissionCheck } from './MissionCheck'
import { MissionInputs } from './MissionInputs'
import { MoonMap } from './MoonMap'
import { NearbyMap } from './NearbyMap'
import { PowerBudget } from './PowerBudget'
import { ScenarioPicker } from './ScenarioPicker'
import { Section } from './Section'
import { Shortlist } from './Shortlist'
import { SlipPanel } from './SlipPanel'
import { SpreadNote } from './SpreadNote'
import { SummaryCard } from './SummaryCard'
import { Timeline } from './Timeline'
import { TrustNotes } from './TrustNotes'
import { YearStrip } from './YearStrip'

interface Props {
  sites: SiteInfo[]
  scenario: Scenario
  data: ScenarioData
  index: number
  requirements: Requirements
  mode: Mode
  view3d: boolean
  /** Bumped to open the grid from elsewhere, such as the end of the tour. */
  gridRequest: number
  shortlist: ShortlistEntry[]
  onShortlist: (list: ShortlistEntry[]) => void
  onScenario: (scenario: Scenario) => void
  onIndex: (index: number) => void
  onRequirements: (value: Requirements) => void
  onView3d: (open: boolean) => void
}

/** One site at one time: the answer first, and everything else one click away. */
export function SingleView({
  sites,
  scenario,
  data,
  index,
  requirements,
  mode,
  view3d,
  gridRequest,
  shortlist,
  onShortlist,
  onScenario,
  onIndex,
  onRequirements,
  onView3d,
}: Props) {
  const { flags, failed: flagsFailed } = useSiteFlagsState(data.site)
  const plan = mode === 'plan'
  const clamped = Math.min(index, data.track.length - 1)
  const now = data.track[clamped]
  const years = data.year.years.map((row) => row.year)
  // A custom point joins the grid, so it can be weighed against every published site.
  const gridSites = useMemo(
    () => (scenario.custom ? [...sites, scenario.custom] : sites),
    [sites, scenario.custom],
  )

  const open = (site: SiteInfo, month: string, target: number) => {
    const custom = site.group === CUSTOM_GROUP ? site : undefined
    onScenario(site.id === data.site.id ? { ...scenario, month } : { siteId: site.id, month, custom })
    onIndex(target)
  }

  const anchor = nearbyAnchor(data.site, sites)
  const [nearbyRequest, setNearbyRequest] = useState(0)
  useEffect(() => {
    if (nearbyRequest > 0) document.getElementById('nearby-ground')?.scrollIntoView({ block: 'start' })
  }, [nearbyRequest])

  const here: ShortlistEntry = {
    site: data.site.group === CUSTOM_GROUP ? `${data.site.lat},${data.site.lon}` : data.site.id,
    at: entryAt(now.t),
  }

  return (
    <>
      <div className="overview">
        <div className="overview-pick">
          <ScenarioPicker sites={sites} scenario={scenario} onChange={onScenario} brief={!plan} />
          <DateField
            value={now.t.slice(0, 16)}
            min={`${years[0]}-01-01T00:00`}
            max={`${years[years.length - 1]}-12-31T23:00`}
            onPick={(value) => {
              const place = locateDate(value, years)
              if (place) open(data.site, place.month, place.index)
              return place !== null
            }}
          />
        </div>
        <div className="overview-answer">
          <AnswerCard data={data} index={clamped} flags={flags} flagsFailed={flagsFailed} requirements={requirements} mode={mode} />
        </div>
        <div className="overview-hero">
          <HeroView data={data} index={clamped} view3d={view3d} onView3dChange={onView3d} mode={mode} />
        </div>
        <div className="overview-slip">
          <SlipPanel
            data={data}
            index={clamped}
            flags={flags}
            sites={sites}
            requirements={plan ? requirements : BOTH_UP}
            plan={plan}
            onGo={open}
            onSeeNearby={anchor ? () => setNearbyRequest((count) => count + 1) : undefined}
            onShortlist={(iso) => onShortlist(addEntries(shortlist, [{ site: here.site, at: entryAt(iso) }]))}
          />
        </div>
      </div>

      <div className="sections">
        <Section
          key={`grid-${gridRequest}-${mode}`}
          title="Where and when can we land?"
          hint="Every site, every month, at a glance"
          defaultOpen={plan || gridRequest > 0}
        >
          <div id="landing-grid">
            <LandingGrid
              sites={gridSites}
              siteId={scenario.siteId}
              month={data.month}
              requirements={requirements}
              mode={mode}
              onOpen={(site, month, target) => {
                open(site, month, target)
                window.scrollTo({ top: 0 })
              }}
            />
          </div>
        </Section>

        {plan && (
          <Section title="Can you land here?" hint="Set your mission's limits and find landing windows" defaultOpen>
            <MissionInputs value={requirements} onChange={onRequirements} />
            <MissionCheck data={data} index={clamped} requirements={requirements} onJump={(month, target) => open(data.site, month, target)} />
          </Section>
        )}

        {plan && (
          <Section
            title="Shortlist"
            hint={shortlist.length > 0 ? `${shortlist.length} options, ranked against your limits` : 'Rank site and date options against your limits'}
            defaultOpen
          >
            <Shortlist
              sites={sites}
              list={shortlist}
              current={here}
              requirements={requirements}
              onChange={onShortlist}
              onAdd={(entries) => onShortlist(addEntries(shortlist, entries))}
              onOpen={(site, iso) => {
                const place = locateHour(iso, 0)
                open(site, place.month, place.index)
                window.scrollTo({ top: 0 })
              }}
            />
          </Section>
        )}

        {anchor && (
          <Section
            key={`nearby-${nearbyRequest}`}
            title="The ground around this site"
            hint="How far you'd move for more Sun or Earth, and how steep it is"
            defaultOpen={nearbyRequest > 0}
          >
            <div id="nearby-ground">
              <NearbyMap
                anchor={anchor}
                point={data.site}
                month={data.month}
                mode={mode}
                onOpen={(lat, lon) => {
                  if (lat === anchor.lat && lon === anchor.lon) {
                    onScenario({ siteId: anchor.id, month: scenario.month })
                  } else {
                    const custom = customSiteInfo(lat, lon)
                    onScenario({ siteId: custom.id, month: scenario.month, custom })
                  }
                  window.scrollTo({ top: 0 })
                }}
              />
            </div>
          </Section>
        )}

        <Section
          title={`${data.site.name} through ${monthLabel(data.month)}`}
          hint="When the Sun and Earth are up, and the seasons"
        >
          <YearStrip year={data.year} month={scenario.month} onSelect={(month) => onScenario({ ...scenario, month })} />
          <h3>When each is up</h3>
          <Timeline summary={data.summary} track={data.track} index={clamped} onSelect={onIndex} />
          <SummaryCard
            summary={data.summary}
            meanSunElevationDeg={meanSunElevationUp(data)}
            sunlight={panelSunlight(data.track)}
            plan={plan}
          />
          {plan && (
            <PowerBudget
              verticalSunlightWm2={panelSunlight(data.track).vertical}
              longestSunGapH={data.summary.max_sun_gap_h}
            />
          )}
          <DownloadCsv siteId={data.site.id} month={data.month} track={data.track} />
          <SpreadNote data={data} plan={plan} />
        </Section>

        {plan && (
          <Section title="Would a taller mast help?" hint="Sun and Earth at 2, 5 and 10 m above the ground">
            <MastHeights site={data.site} year={Number(data.month.slice(0, 4))} />
          </Section>
        )}

        <Section
          title="A day on Earth, and a day here"
          hint="How the Sun moves in each place"
        >
          <EarthVsMoon data={data} index={clamped} onIndexChange={onIndex} />
        </Section>

        <Section title={explainerTitle(data)} hint="In plain words, with this site's numbers">
          <Explainer data={data} />
        </Section>

        <Section title="Map of landing sites" hint="The whole Moon with live day and night; click to choose">
          <MoonMap sites={sites} scenario={scenario} onChange={onScenario} now={now} />
        </Section>

        <Section title="How far to trust this" hint="What these numbers were checked against">
          <TrustNotes data={data} />
        </Section>
      </div>
    </>
  )
}
