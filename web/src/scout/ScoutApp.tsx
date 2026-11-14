import { OLD_HOME } from '../lib/siteTabs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import { loadSites } from '../data/loadSite'
import { useScenario } from '../data/useScenario'
import { useSiteFlagsState } from '../data/useSiteFlags'
import { Moon3DSection } from '../components/Moon3DSection'
import { SiteTabs } from '../components/SiteTabs'
import { setAddressBar } from '../lib/address'
import { answerAt, headlineOf } from '../lib/answer'
import { askCopilot, type ChatMessage, MAX_QUESTION_CHARS, starterQuestions, stillWaitingText } from '../lib/chatClient'
import { useCooldown } from '../lib/cooldown'
import type { Requirements } from '../lib/mission'
import { monthLabel } from '../lib/months'
import { riverState } from '../lib/river'
import { decodeView, encodeView } from '../lib/urlState'
import { TimeRiver } from '../shell/TimeRiver'
import { Bubble } from './Bubble'
import { Mascot } from './Mascot'
import { MoonStage } from './MoonStage'
import { AskScout, ChooseSite } from './SitePanel'
import { useVoice } from './useVoice'

const DEFAULT_MONTH = '2027-05'
const FEATURED = 'connecting-ridge'
/** Links carry mission limits; Scout doesn't change them, so it writes the app's example ones. */
const LIMITS: Requirements = { missionDays: 14, maxSunGapH: 72, maxEarthGapH: 72, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

interface Place {
  siteId: string
  month: string
  index: number
}

/** The place a link points at, if it names a listed site. Compare links open their first site. */
function placeFrom(hash: string): Place | null {
  const link = decodeView(hash, LIMITS)
  return link ? { siteId: link.a.site, month: link.a.month, index: link.index } : null
}

/**
 * Scout: the same data and co-pilot as the main site, as a guided conversation. The Moon is the
 * canvas, one question is asked at a time, and Scout talks in a speech bubble beside its mark.
 */
export function ScoutApp() {
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [failed, setFailed] = useState(false)
  const [place, setPlace] = useState<Place | null>(() => placeFrom(window.location.hash))
  /** The close-up 3D ground view, shown over the Moon when asked for. */
  const [ground, setGround] = useState(false)
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [waiting, setWaiting] = useState(false)
  // A "busy" from the server says how long to wait (Retry-After); this counts it down.
  const cooldown = useCooldown()
  /** What the co-pilot is looking up right now, while waiting for its answer. */
  const [step, setStep] = useState<string | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  /** Whether the visitor has moved time or asked something yet; until then Scout adds a hint. */
  const [greeted, setGreeted] = useState(false)
  /** The bubble folded away, so nothing covers the Moon. */
  const [quiet, setQuiet] = useState(false)

  useEffect(() => {
    loadSites().then(setSites).catch(() => setFailed(true))
  }, [])

  const site = sites.find((candidate) => candidate.id === place?.siteId) ?? null
  const featured = sites.find((candidate) => candidate.id === FEATURED) ?? sites[0] ?? null
  // On the Moon view, the featured site's hours light the globe.
  const { data } = useScenario(site ?? featured, place?.month ?? DEFAULT_MONTH)
  const { flags } = useSiteFlagsState(site)
  const here = site && data && data.site.id === site.id && data.month === place?.month ? data : null
  const index = here ? Math.min(place?.index ?? 0, here.track.length - 1) : 0
  const now = here ? here.track[index] : null

  // The address always reopens what is on screen, and the tabs open the other designs on the same view.
  const address =
    site && place
      ? encodeView({ a: { site: site.id, month: place.month }, b: null, index: place.index, requirements: LIMITS, view3d: true, mode: 'learn', shortlist: [] })
      : ''
  useEffect(() => {
    if (sites.length > 0) setAddressBar(address || window.location.pathname)
  }, [sites.length, address])

  // A link pasted into the open tab: go where it points. The app's own address rewrites don't fire this.
  useEffect(() => {
    const onHashChange = () => {
      setPlace(placeFrom(window.location.hash))
      setShowAnswer(false)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Moving time puts an old answer away, so Scout goes back to describing the hour on screen.
  const setIndex = useCallback((next: number) => {
    setShowAnswer(false)
    setGreeted(true)
    setPlace((current) => (current ? { ...current, index: next } : current))
  }, [])
  const land = useCallback((chosen: SiteInfo) => {
    setShowAnswer(false)
    setPlace((current) => ({ siteId: chosen.id, month: current?.month ?? DEFAULT_MONTH, index: 0 }))
  }, [])

  const ask = async (question: string) => {
    const text = question.trim().slice(0, MAX_QUESTION_CHARS)
    if (!text || waiting) return
    // The server said "busy, wait this long" (Retry-After): say so again, and send nothing until then.
    if (cooldown.secondsLeft > 0) {
      setThread([...thread.filter((message) => !message.failed), { role: 'assistant', text: stillWaitingText(cooldown.secondsLeft), failed: true }])
      setShowAnswer(true)
      setQuiet(false)
      return
    }
    // Asking is a tap or a key press: the moment the browser lets the answer be heard later.
    voice.prime()
    const next: ChatMessage[] = [...thread, { role: 'user', text }]
    setThread(next)
    setWaiting(true)
    setShowAnswer(true)
    setGreeted(true)
    setQuiet(false)
    setStep(null)
    const answer = await askCopilot(next, window.location.hash, setStep)
    if (answer.retryAfterSeconds) cooldown.start(answer.retryAfterSeconds)
    setThread([...next, answer])
    setWaiting(false)
  }

  const compact = useMemo(() => window.matchMedia('(max-width: 820px)').matches, [])
  const latest = thread.at(-1)
  const answer = showAnswer && latest?.role === 'assistant' ? latest : null
  // Scout says the answer that is on show. Folding the bubble, asking again or leaving the site puts it away.
  const voice = useVoice(answer && !quiet && site ? answer : null)
  const lastYear = here ? here.year.years[here.year.years.length - 1].year : 0

  // What Scout says on its own: always about the hour on screen, from the same data as everything else.
  const line = useMemo(() => {
    if (failed) return "I can't load the site list right now. Try again in a moment."
    if (!site) return "Hi, I'm Scout! Pick a landing site and I'll tell you when the Sun and Earth are up."
    if (!now || !here) return `Unpacking the terrain at ${site.name}…`
    const next = flags ? answerAt(now, flags, lastYear) : null
    // On a phone the picture is small, so Scout keeps to the headline and the Sun.
    if (compact) return `${headlineOf(now)}${next ? ` ${next.sun.label}.` : ''}`
    const when = next ? ` ${next.sun.label}. ${next.earth.label}.` : ''
    // The hint is for a first look; after that, just the hour.
    return `${headlineOf(now)}${when}${greeted ? '' : ' Drag the river to move time, or ask me anything.'}`
  }, [failed, site, now, here, flags, lastYear, greeted, compact])

  // Scout's mark carries what is in view at the site right now.
  const state = now ? riverState(now) : null
  const months = here ? here.year.months.map((row) => row.month) : []
  const monthStep = (step: number) => {
    const to = months[months.indexOf(place?.month ?? '') + step]
    return { label: to ? monthLabel(to).split(' ')[0] : '', onClick: to ? () => setPlace((current) => (current ? { ...current, month: to, index: 0 } : current)) : null }
  }
  const ideas = site ? starterQuestions(site.name, monthLabel(place?.month ?? DEFAULT_MONTH), false) : []
  const moonIdeas = [FEATURED, 'shackleton-rim', 'apollo-11'].flatMap((id) => sites.filter((candidate) => candidate.id === id)).map((candidate) => candidate.name)

  return (
    <div className={site ? 'scout at-site' : 'scout'}>
      <SiteTabs current="scout" view={address} />
      <aside className="scout-panel">
        <header className="scout-brand">
          <span className="scout-logo" aria-hidden="true">
            <Mascot state={null} />
          </span>
          <span className="scout-wordmark">Shackleton Station</span>
        </header>
        <div className="scout-rule" aria-hidden="true">
          <span>✦</span>
        </div>
        <div className="scout-panel-body">
          {site ? (
            <AskScout
              sites={sites}
              site={site}
              month={place?.month ?? DEFAULT_MONTH}
              months={months}
              ideas={ideas}
              waiting={waiting}
              onAsk={(question) => void ask(question)}
              onSite={land}
              onMonth={(month) => setPlace((current) => (current ? { ...current, month, index: 0 } : current))}
              view={address}
              onMic={voice.micPressed}
              onHeard={voice.micHeard}
              onBack={() => {
                setPlace(null)
                setShowAnswer(false)
                setGround(false)
              }}
            />
          ) : (
            <ChooseSite sites={sites} onChoose={land} />
          )}
        </div>
        <footer className="scout-links">
          <a href={`${OLD_HOME}#how`}>How it works</a>
          <a href={OLD_HOME}>Classic view</a>
          <span>Practice demo by team Shackleton Station. Scout’s mark and voice are AI-generated.</span>
        </footer>
      </aside>

      <main className="scout-stage">
        <MoonStage
          sites={sites}
          track={site ? null : (data?.track ?? null)}
          site={site}
          now={now}
          onChoose={land}
          onLeave={() => {
            setPlace(null)
            setShowAnswer(false)
            setGround(false)
          }}
        />
        {site && here && now && (
          <>
            {ground && (
              <div className="scout-ground">
                <Moon3DSection site={here.site} now={now} obsHeightM={here.summary.obs_height_m} />
              </div>
            )}
            <div className="scout-views" role="group" aria-label="View">
              <button type="button" aria-pressed={!ground} onClick={() => setGround(false)}>
                Moon
              </button>
              <button type="button" aria-pressed={ground} onClick={() => setGround(true)}>
                Ground, close up
              </button>
            </div>
            <div className="scout-river">
              <TimeRiver track={here.track} index={index} onIndex={setIndex} previous={monthStep(-1)} next={monthStep(1)} />
            </div>
          </>
        )}

        <div className={site && here ? 'scout-guide above-river' : 'scout-guide'}>
          <button type="button" className="scout-face" aria-expanded={!quiet} aria-label={quiet ? 'Show what Scout is saying' : 'Hide what Scout is saying'} onClick={() => setQuiet(!quiet)}>
            <Mascot state={state} pulse={answer ? answer.text : line} />
          </button>
          {!quiet && <Bubble
            text={answer ? answer.text : line}
            answer={answer}
            thinking={waiting}
            step={step}
            ideas={site ? [] : moonIdeas}
            onAsk={(chip) => {
              const named = sites.find((candidate) => candidate.name === chip)
              if (!site && named) land(named)
              else void ask(chip)
            }}
            onOpen={(hash) => {
              const to = placeFrom(hash)
              if (to) setPlace(to)
              // On a phone the answer covers the ground it just opened, so put it away.
              if (window.matchMedia('(max-width: 820px)').matches) setShowAnswer(false)
            }}
            onDismiss={() => setShowAnswer(false)}
            sound={voice.sound}
            onSound={voice.setSound}
            unsaid={voice.sound && voice.failed}
          />}
        </div>
      </main>
    </div>
  )
}
