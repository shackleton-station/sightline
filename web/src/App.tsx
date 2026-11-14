import { useCallback, useEffect, useReducer, useState } from 'react'
import { AnswerCard } from './components/AnswerCard'
import { AskBox } from './components/AskBox'
import { CompareView } from './components/CompareView'
import { DemoVideo } from './components/DemoVideo'
import { HeroView } from './components/HeroView'
import { LandingPage } from './components/LandingPage'
import { ModeToggle } from './components/ModeToggle'
import { PlanPage } from './components/PlanPage'
import { SharePlan } from './components/SharePlan'
import { SingleView } from './components/SingleView'
import { SiteTabs } from './components/SiteTabs'
import { StoryPlayer } from './components/StoryPlayer'
import { TimeBar } from './components/TimeBar'
import { TimeSlider } from './components/TimeSlider'
import type { SiteInfo } from './data/contract'
import { loadSites } from './data/loadSite'
import { useAllFlags } from './data/useAllFlags'
import { useScenario } from './data/useScenario'
import { useSiteFlags } from './data/useSiteFlags'
import { dayLabel } from './lib/compare'
import { opens3dFirst, readDeviceHints } from './lib/device'
import type { Requirements } from './lib/mission'
import { monthLabel } from './lib/months'
import type { Scenario } from './lib/scenario'
import type { ShortlistEntry } from './lib/shortlist'
import type { CameraCue } from './lib/story'
import { HowItWorks } from './shell/HowItWorks'
import { MissionControl } from './shell/MissionControl'
import { ViewProvider } from './state/ViewContext'
import { useUrlSync } from './state/useUrlSync'
import { DEFAULT_MONTH, initialView, viewReducer } from './state/viewStore'

const NO_SITES: SiteInfo[] = []
/** The redesigned site page, opted into with ?ui=next until it does everything the old one does. */
const NEXT_UI = new URLSearchParams(window.location.search).get('ui') === 'next'

function App() {
  const [view, dispatch] = useReducer(viewReducer, window.location.hash, initialView)
  const { sites, sitesError, a: scenarioA, b: scenarioB, index, requirements, view3d, mode, shortlist, tour } = view
  const { tourPaused, landing, page, gridRequest, planId } = view
  /** The view a shared plan holds, once it has loaded, so the design tabs open on it. */
  const [planView, setPlanView] = useState('')
  const [copiedHash, setCopiedHash] = useState<string | null>(null)
  const [ready3d, setReady3d] = useState(false)

  useEffect(() => {
    loadSites()
      .then((list) => {
        const open3d = opens3dFirst(readDeviceHints())
        dispatch({ type: 'sitesLoaded', sites: list, hash: window.location.hash, open3d })
      })
      .catch((reason: unknown) => dispatch({ type: 'sitesFailed', error: String(reason) }))
  }, [])

  const viewHash = useUrlSync(view, dispatch)

  const setScenarioA = useCallback((scenario: Scenario | null) => dispatch({ type: 'setScenario', side: 'a', scenario }), [])
  const setScenarioB = useCallback((scenario: Scenario | null) => dispatch({ type: 'setScenario', side: 'b', scenario }), [])
  const setIndex = useCallback((next: number) => dispatch({ type: 'setIndex', index: next }), [])
  const setRequirements = useCallback((next: Requirements) => dispatch({ type: 'setRequirements', requirements: next }), [])
  const setView3d = useCallback((next: boolean) => dispatch({ type: 'setView3d', view3d: next }), [])
  const setShortlist = useCallback((next: ShortlistEntry[]) => dispatch({ type: 'setShortlist', shortlist: next }), [])
  const startTour = () => dispatch({ type: 'startTour', open3d: opens3dFirst(readDeviceHints()) })

  const findSite = (scenario: Scenario | null) =>
    scenario?.custom ?? sites.find((site) => site.id === scenario?.siteId) ?? null
  const a = useScenario(findSite(scenarioA), scenarioA?.month ?? DEFAULT_MONTH)
  const b = useScenario(findSite(scenarioB), scenarioB?.month ?? DEFAULT_MONTH)
  const dataA = a.data
  const dataB = scenarioB ? b.data : null
  const failure = sitesError ?? a.error ?? (scenarioB ? b.error : null)
  const flagsA = useSiteFlags(dataA?.site ?? null)
  const allFlags = useAllFlags(tour ? sites : NO_SITES)

  // Only one side changes at a time, so the slider can stay on an hour both months have.
  const comparing = dataA !== null && dataB !== null
  const longest = comparing && dataB.track.length > dataA.track.length ? dataB : dataA
  const times = longest?.track.map((point) => point.t) ?? []
  const last = Math.max(times.length - 1, 0)

  const closeTour = (keepView: boolean) => dispatch({ type: 'closeTour', keepView })

  const onTourScene = useCallback(
    (siteId: string, month: string, camera: CameraCue) => dispatch({ type: 'tourScene', siteId, month, camera }),
    [],
  )

  const monthStep = (step: number) => {
    if (!dataA || !scenarioA) return undefined
    const months = dataA.year.months.map((row) => row.month)
    const target = months[months.indexOf(scenarioA.month) + step]
    return {
      label: target ? monthLabel(target) : monthLabel(scenarioA.month),
      onClick: target ? () => setScenarioA({ ...scenarioA, month: target }) : null,
    }
  }

  const actions = !tour && scenarioA && sites.length > 1 && (
        <p className="actions">
          <button
            type="button"
            onClick={() => dispatch({ type: scenarioB ? 'closeCompare' : 'openCompare' })}
            aria-pressed={scenarioB !== null}
          >
            {scenarioB ? 'Close comparison' : 'Compare with another site or date'}
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                .writeText(window.location.href)
                .then(() => setCopiedHash(viewHash))
                .catch(() => setCopiedHash(null))
            }}
          >
            {copiedHash === viewHash ? 'Link copied' : 'Copy link to this view'}
          </button>
          {dataA && <SharePlan view={viewHash} suggestedTitle={`${dataA.site.name}, ${monthLabel(dataA.month)}`} />}
        </p>
  )

  useEffect(() => {
    if (gridRequest > 0) document.getElementById('landing-grid')?.scrollIntoView({ block: 'start' })
  }, [gridRequest])

  const header = (
    <header className="app-header">
      <div>
        <h1>Lunar Landing Site Navigator</h1>
        <p className="tag">All times UTC</p>
      </div>
      <div className="header-actions">
        {!tour && (
          <button
            type="button"
            className="tour-button"
            onClick={() => dispatch({ type: 'openLanding' })}
          >
            🌕 Whole Moon
          </button>
        )}
        {!tour && (
          <button
            type="button"
            className="tour-button"
            aria-pressed={page === 'demo'}
            onClick={() => dispatch({ type: 'setPage', page: page === 'demo' ? 'app' : 'demo' })}
          >
            {page === 'demo' ? '← Back to the app' : '▶ Demo video'}
          </button>
        )}
        {!tour && scenarioA && (
          <button type="button" className="tour-button" onClick={startTour}>
            ▶ 1-minute tour
          </button>
        )}
        <ModeToggle mode={mode} onChange={(next) => dispatch({ type: 'setMode', mode: next })} />
      </div>
    </header>
  )

  if (page === 'how' && !tour) {
    return (
      <>
        <SiteTabs current="how" view={viewHash} />
        <HowItWorks
        data={dataA}
        siteCount={sites.length}
        // Back goes where the visitor came from: the front page, or the site they were looking at.
        backLabel={landing || !dataA ? 'Back to the Moon' : `Back to ${dataA.site.name}`}
        onBack={() => dispatch({ type: 'setPage', page: 'app' })}
      />
      </>
    )
  }

  if (page === 'plan' && planId && !tour) {
    return (
      <>
        <SiteTabs current="none" view={planView || viewHash} />
        <PlanPage id={planId} onOpen={(to) => dispatch({ type: 'applyLink', hash: to })} onLoaded={setPlanView} />
      </>
    )
  }

  if (page === 'demo' && !tour) {
    return (
      <ViewProvider view={view} dispatch={dispatch}>
        <SiteTabs current="video" view={viewHash} />
        <main className="app">
          {header}
          <DemoVideo onBack={() => dispatch({ type: 'setPage', page: 'app' })} />
        </main>
      </ViewProvider>
    )
  }

  if (landing && !tour) {
    return (
      <ViewProvider view={view} dispatch={dispatch}>
        <SiteTabs current="moon" view={viewHash} />
        <main className="app landing-app">
          {failure && (
            <p className="pending" role="alert">
              Data could not be loaded: {failure}
            </p>
          )}
          <LandingPage
            sites={sites}
            track={dataA?.track ?? null}
            onEnter={(site) => {
              dispatch({ type: 'enterSite', site })
              window.scrollTo({ top: 0 })
            }}
            onDemo={() => {
              dispatch({ type: 'leaveLanding' })
              dispatch({ type: 'setPage', page: 'demo' })
            }}
            onTour={startTour}
            onHow={() => dispatch({ type: 'setPage', page: 'how' })}
          />
        </main>
      </ViewProvider>
    )
  }

  if (NEXT_UI && !tour && scenarioA && !scenarioB && dataA && !failure) {
    return (
      <ViewProvider view={view} dispatch={dispatch}>
        <MissionControl data={dataA} />
      </ViewProvider>
    )
  }

  return (
    <ViewProvider view={view} dispatch={dispatch}>
      {/* Comparing and the tour only exist in this layout, so they show here whichever design was open. */}
      <SiteTabs current={tour ? 'tour' : NEXT_UI ? 'mission' : 'classic'} view={viewHash} />
      <main className={times.length > 0 ? 'app has-bar' : 'app'}>
        {header}

        {!tour && scenarioA && sites.length > 0 && <AskBox sites={sites} requirements={requirements} />}

        {failure && (
          <p className="pending" role="alert">
            Data could not be loaded: {failure}
          </p>
        )}
        {!failure && !dataA && <p className="pending">Loading…</p>}
        {!failure && dataA && (a.loading || (scenarioB && b.loading)) && (
          <p className="loading" role="status">
            Loading terrain and working out this site…
          </p>
        )}

        {tour && (
          <div className="overview tour-mode">
            <div className="overview-answer">
              <StoryPlayer
                data={dataA}
                all={allFlags}
                ready={!view3d || ready3d}
                paused={tourPaused}
                onPausedChange={(paused) => dispatch({ type: 'pauseTour', paused })}
                onScene={onTourScene}
                onIndex={setIndex}
                onClose={closeTour}
                onOpenGrid={() => dispatch({ type: 'openGrid' })}
              />
              {dataA && <AnswerCard data={dataA} index={index} flags={flagsA} requirements={requirements} mode={mode} />}
            </div>
            <div className="overview-hero">
              {dataA && (
                <HeroView
                  data={dataA}
                  index={index}
                  view3d={view3d}
                  onView3dChange={setView3d}
                  mode={mode}
                  camera={tour.camera}
                  onReadyChange={setReady3d}
                />
              )}
            </div>
          </div>
        )}

        {scenarioB && actions}

        {!tour && scenarioA && !scenarioB && dataA && (
          <SingleView
            sites={sites}
            scenario={scenarioA}
            data={dataA}
            index={index}
            requirements={requirements}
            mode={mode}
            view3d={view3d}
            gridRequest={gridRequest}
            shortlist={shortlist}
            onShortlist={setShortlist}
            onScenario={setScenarioA}
            onIndex={setIndex}
            onRequirements={setRequirements}
            onView3d={setView3d}
          />
        )}

        {!tour && scenarioA && scenarioB && (
          <CompareView
            sites={sites}
            scenarioA={scenarioA}
            scenarioB={scenarioB}
            dataA={dataA}
            dataB={dataB}
            index={index}
            requirements={requirements}
            mode={mode}
            onScenarioA={setScenarioA}
            onScenarioB={setScenarioB}
            onIndex={setIndex}
            onRequirements={setRequirements}
          />
        )}

        {!scenarioB && actions}

        <footer className="note">
          Terrain: NASA LOLA (PGDA). Ephemeris: NAIF SPICE, checked against JPL Horizons. Sources and
          terms are listed in the project's REFERENCES.md. <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a>
        </footer>

        {times.length > 0 && (
          <TimeBar previous={tour || comparing ? undefined : monthStep(-1)} next={tour || comparing ? undefined : monthStep(1)}>
            <TimeSlider
              times={times}
              index={Math.min(index, last)}
              onChange={(next) => {
                if (tour) dispatch({ type: 'pauseTour', paused: true })
                setIndex(next)
              }}
              label={comparing ? dayLabel(times[Math.min(index, last)]) : undefined}
              hidePlay={tour !== null}
            />
          </TimeBar>
        )}
      </main>
    </ViewProvider>
  )
}

export default App
