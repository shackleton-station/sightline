import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SiteTabs } from '../components/SiteTabs'
import type { SiteInfo, TrackPoint } from '../data/contract'
import { loadSites } from '../data/loadSite'
import { useScenario } from '../data/useScenario'
import { useSiteFlagsState } from '../data/useSiteFlags'
import { setAddressBar } from '../lib/address'
import { answerAt, headlineOf } from '../lib/answer'
import { askCopilot, type ChatMessage, MAX_QUESTION_CHARS, starterQuestions, stillWaitingText } from '../lib/chatClient'
import { useCooldown } from '../lib/cooldown'
import { type Cell, cellAt, cellCenter, distanceKm, spotAt } from '../lib/lightGrid'
import { DEFAULT_REQUIREMENTS, type Requirements } from '../lib/mission'
import { monthLabel } from '../lib/months'
import { DEFAULT_VIEW } from '../lib/siteTabs'
import { decodeView, encodeView } from '../lib/urlState'
import { Bubble } from '../scout/Bubble'
import { Mascot } from '../scout/Mascot'
import { useVoice } from '../scout/useVoice'
import type { LightView } from '../three/lightLayer'
import { AtlasStage, type Goal } from './AtlasStage'
import { AtlasTour } from './AtlasTour'
import { HelpIcon } from './icons'
import { LayerMenu } from './LayerMenu'
import { lookFrom, sunState } from './looks'
import { SunStatus } from './SunStatus'
import { TimeControl } from './TimeControl'
import { tourSeen } from './tour'
import { LayerKey } from './LayerKey'
import { distanceWords, placeWords, spotWords } from './spotWords'
import { useLightGrid } from './useLightGrid'

/** Links carry mission limits; the Atlas doesn't change them, so it writes the app's example ones. */
const LIMITS: Requirements = DEFAULT_REQUIREMENTS

interface Place {
  siteId: string
  month: string
  index: number
}

/** The place a link points at. Compare links open their first site; no link opens the example view. */
function placeFrom(hash: string): Place | null {
  const link = decodeView(hash, LIMITS)
  return link ? { siteId: link.a.site, month: link.a.month, index: link.index } : null
}

const LAYERS: { id: LightView; label: string; hint: string }[] = [
  { id: 'light', label: 'Sunlight', hint: 'Where the Sun is in view this hour' },
  { id: 'both', label: 'Sun + Earth', hint: 'Where the Sun, Earth, both or neither are in view this hour' },
  { id: 'month', label: "Month's Sun", hint: 'How much of the month each place has the Sun' },
]

/** The coloring a link asks for ("&layer=both"); sunlight when it names none. Only this page reads it. */
function layerFrom(hash: string): LightView {
  const asked = new URLSearchParams(hash.replace(/^#/, '')).get('layer')
  return LAYERS.find((option) => option.id === asked)?.id ?? 'light'
}

const OPEN_POINT = 'Open this exact point'
const ASK_SPOT = 'Ask Scout about this spot'

/**
 * The Atlas: one picture of the Moon, from the whole disk down to a ridge, where the light on the
 * polar ground is the pipeline's own answer for every 120 m of it. Time is the river along the
 * bottom, the guide is Scout, and any ground inside the square can be tapped for its own month.
 */
export function AtlasApp() {
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [failed, setFailed] = useState(false)
  const [place, setPlace] = useState<Place>(() => placeFrom(window.location.hash) ?? (placeFrom(DEFAULT_VIEW) as Place))
  const [layer, setLayer] = useState<LightView>(() => layerFrom(window.location.hash))
  const [look, setLook] = useState(() => lookFrom(window.location.hash))
  const [touring, setTouring] = useState(() => !tourSeen())
  /** The pixel the visitor tapped, and which of the two grids it belongs to. */
  const [picked, setPicked] = useState<{ grid: 'fine' | 'wide'; cell: Cell } | null>(null)
  const [goal, setGoal] = useState<Goal>({ id: 0, to: 'site' })
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [waiting, setWaiting] = useState(false)
  // A "busy" from the server says how long to wait (Retry-After); this counts it down.
  const cooldown = useCooldown()
  const [step, setStep] = useState<string | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [greeted, setGreeted] = useState(false)
  const [quiet, setQuiet] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    loadSites().then(setSites).catch(() => setFailed(true))
  }, [])

  const site = sites.find((candidate) => candidate.id === place.siteId) ?? null
  const { data } = useScenario(site, place.month)
  const { flags } = useSiteFlagsState(site)
  const here = site && data && data.site.id === site.id && data.month === place.month ? data : null
  const index = here ? Math.min(place.index, here.track.length - 1) : 0
  const now = here ? here.track[index] : null
  const light = useLightGrid(place.month)
  const meta = light.meta ?? null
  const wideMeta = light.wideMeta

  // The address reopens what is on screen, and the tabs open the other designs on the same view.
  // The coloring is in it too (the other designs ignore it), so a link, and someone following a presenter, get the same picture.
  // While a site's month is still loading the hour is the one asked for, so the address never says "hour 0" for a moment.
  const hourInAddress = here ? index : place.index
  const view = site ? encodeView({ a: { site: site.id, month: place.month }, b: null, index: hourInAddress, requirements: LIMITS, view3d: true, mode: 'learn', shortlist: [] }) : ''
  // The look goes in the address too, so a link opens the same design ("&look=b"); Observatory needs none.
  const extras = `${layer !== 'light' ? `&layer=${layer}` : ''}${look !== 'a' ? `&look=${look}` : ''}`
  const address = view ? `${view}${extras}` : view
  useEffect(() => {
    if (address) setAddressBar(address)
  }, [address])
  const siteNow = useRef(place.siteId)
  useEffect(() => {
    siteNow.current = place.siteId
  }, [place.siteId])
  // A link pasted into the open tab, or a presenter being followed: go where it points.
  useEffect(() => {
    const onHashChange = () => {
      const to = placeFrom(window.location.hash)
      if (to) setPlace(to)
      setLayer(layerFrom(window.location.hash))
      setLook(lookFrom(window.location.hash))
      setShowAnswer(false)
      // Another site: fly to it. The same site at another hour leaves the camera, and a tapped spot, where they are.
      if (!to || to.siteId === siteNow.current) return
      setPicked(null)
      setGoal((last) => ({ id: last.id + 1, to: 'site' }))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const setIndex = useCallback((next: number) => {
    setShowAnswer(false)
    setGreeted(true)
    setPlace((current) => ({ ...current, index: next }))
  }, [])
  const choose = useCallback((chosen: SiteInfo) => {
    setShowAnswer(false)
    setPicked(null)
    setPlace((current) => ({ ...current, siteId: chosen.id }))
    // Choosing the site already on screen flies back to it.
    setGoal((last) => ({ id: last.id + 1, to: 'site' }))
  }, [])
  const pick = useCallback(
    (lat: number, lon: number) => {
      // The fine grid where it reaches; around it, the wide one.
      const fine = meta ? cellAt(meta, lat, lon) : null
      const wide = !fine && wideMeta ? cellAt(wideMeta, lat, lon) : null
      setPicked(fine ? { grid: 'fine', cell: fine } : wide ? { grid: 'wide', cell: wide } : null)
      setShowAnswer(false)
      setGreeted(true)
      setQuiet(false)
    },
    [meta, wideMeta],
  )

  // A tapped spot, read from the grid: its own hours for the month, and how its neighbours differ.
  const pickedMonth = picked?.grid === 'wide' ? light.wide : light.month
  const pickedMeta = picked?.grid === 'wide' ? wideMeta : meta
  const spot = useMemo(() => (picked && pickedMonth ? spotAt(pickedMonth, picked.cell) : null), [picked, pickedMonth])
  const spotPlace = useMemo(() => (picked && pickedMeta ? cellCenter(pickedMeta, picked.cell) : null), [picked, pickedMeta])
  // With a spot chosen, the river shows that spot's month instead of the site's.
  const riverTrack = useMemo<TrackPoint[] | null>(() => {
    if (!here) return null
    if (!spot || spot.sun.length !== here.track.length) return here.track
    return here.track.map((point, hour) => ({ ...point, sun_up: spot.sun[hour] === 1, earth_up: spot.earth[hour] === 1 }))
  }, [here, spot])

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
    // With a spot tapped, the co-pilot is told where, so "this spot" means it.
    const answer = await askCopilot(next, window.location.hash, setStep, spotPlace)
    if (answer.retryAfterSeconds) cooldown.start(answer.retryAfterSeconds)
    setThread([...next, answer])
    setWaiting(false)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void ask(draft)
    setDraft('')
  }

  const latest = thread.at(-1)
  const answer = showAnswer && latest?.role === 'assistant' ? latest : null
  // Scout says the answer that is on show, if the visitor has turned sound on (the same voice as on Scout's own page).
  const voice = useVoice(answer && !quiet ? answer : null)
  const lastYear = here ? here.year.years[here.year.years.length - 1].year : 0
  const siteInGrid = site !== null && [meta, wideMeta].some((grid) => grid !== null && cellAt(grid, site.lat, site.lon) !== null)

  // What Scout says on its own: the tapped spot if there is one, otherwise the site's hour on screen.
  const line = useMemo(() => {
    if (failed) return "I can't load the site list right now. Try again in a moment."
    if (!site || !now || !here) return 'Flying down to the site…'
    if (spot && spotPlace && pickedMeta) {
      const meta = pickedMeta
      const away = distanceKm(spotPlace, site, meta.radius_m)
      return `This spot (${placeWords(spotPlace.lat, spotPlace.lon)}), ${distanceWords(away)} from ${site.name}. ${spotWords(spot, index, monthLabel(place.month), meta)} One ${meta.pixel_m} m square, ${meta.obs_height_m} m up.`
    }
    const next = flags ? answerAt(now, flags, lastYear) : null
    const when = next ? ` ${next.sun.label}. ${next.earth.label}.` : ''
    const hint = greeted ? '' : siteInGrid ? ' Drag the river to move time, or tap any ground inside the gold square.' : ' Drag the river to move time, or ask me anything.'
    const headline = headlineOf(now)
    return `${site.name}: ${headline[0].toLowerCase()}${headline.slice(1)}${when}${hint}`
  }, [failed, site, now, here, spot, spotPlace, pickedMeta, index, place.month, flags, lastYear, greeted, siteInGrid])

  const upNow = spot ? { sun: spot.sun[Math.min(index, spot.sun.length - 1)] === 1, earth: spot.earth[Math.min(index, spot.earth.length - 1)] === 1 } : now ? { sun: now.sun_up, earth: now.earth_up } : null
  // Scout's mark carries what is in view right now, at the tapped ground or the site.
  const sunNow = upNow ? sunState(upNow.sun, spot ? undefined : now?.sun_frac) : null
  const state = !upNow ? null : upNow.sun && upNow.earth ? 'both' : upNow.sun ? 'sun' : upNow.earth ? 'earth' : 'none'

  const months = here ? here.year.months.map((row) => row.month) : [place.month]
  const groups = useMemo(() => [...new Set(sites.map((candidate) => candidate.group))], [sites])
  const backToSite = site ? `Back to ${site.name}` : ''
  const ideas = spot ? [ASK_SPOT, OPEN_POINT, backToSite] : site ? starterQuestions(site.name, monthLabel(place.month), false).slice(0, 2) : []
  const exactPoint = spotPlace
    ? `/${encodeView({ a: { site: `${spotPlace.lat.toFixed(5)},${spotPlace.lon.toFixed(5)}`, month: place.month }, b: null, index, requirements: LIMITS, view3d: true, mode: 'learn', shortlist: [] })}`
    : null

  const gridNote =
    light.status === 'loading'
      ? `Loading ${monthLabel(place.month)}'s light for every ${meta?.pixel_m ?? 120} m of the polar ground…`
      : light.status === 'missing'
        ? 'The computed light is not available here, so the Moon is shaded by slope alone.'
        : null

  return (
    <div className={spot ? 'scout atlas with-spot' : 'scout atlas'} data-look={look}>
      <SiteTabs current="atlas" view={view} />
      <main className="scout-stage atlas-stage">
        <AtlasStage
          sites={sites}
          site={site}
          sun={now?.sun_vec_me ?? null}
          hour={index}
          layer={layer}
          light={light}
          picked={spotPlace}
          goal={goal}
          onPick={pick}
          onChoose={choose}
        />

        <div className="atlas-top">
          <div className="atlas-where" data-tour="place">
            <select aria-label="Landing site" value={site?.id ?? ''} onChange={(event) => choose(sites.find((candidate) => candidate.id === event.target.value) as SiteInfo)}>
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {sites
                    .filter((candidate) => candidate.group === group)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <select aria-label="Month" value={place.month} onChange={(event) => setPlace((current) => ({ ...current, month: event.target.value, index: 0 }))}>
              {months.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
            <button type="button" className="atlas-tour-open" aria-label="Open the tour" onClick={() => setTouring(true)}>
              <HelpIcon size={18} />
              <span>Tour</span>
            </button>
          </div>
          {upNow && sunNow && <SunStatus sun={sunNow} earth={upNow.earth} of={spot ? 'This spot' : (site?.name ?? '')} />}
          <div className="atlas-stops" role="group" aria-label="Fly to">
            <button type="button" onClick={() => setGoal((last) => ({ id: last.id + 1, to: 'moon' }))}>
              Whole Moon
            </button>
            <button type="button" onClick={() => setGoal((last) => ({ id: last.id + 1, to: 'pole' }))}>
              South pole
            </button>
            {site && (
              <button type="button" onClick={() => choose(site)}>
                {site.name}
              </button>
            )}
          </div>
        </div>

        <div className="atlas-layers">
          <LayerMenu layers={LAYERS} layer={layer} onLayer={setLayer}>
            <LayerKey layer={layer} />
            <p className="atlas-fine">
              {gridNote ??
                (wideMeta
                  ? `Inside the gold square: computed for each ${wideMeta.pixel_m} m of ground, and each ${meta?.pixel_m ?? 120} m inside the inner square, ${meta?.obs_height_m ?? 2} m up. Outside it, slope shading only.`
                  : `Inside the gold square: computed for each ${meta?.pixel_m ?? 120} m of ground, ${meta?.obs_height_m ?? 2} m up. Outside it, slope shading only.`)}
            </p>
          </LayerMenu>
        </div>

        {here && riverTrack && (
          <div className="atlas-river">
            {spot && (
              <p className="atlas-river-of">
                <span>The river shows the spot you tapped. </span>
                <button type="button" onClick={() => setPicked(null)}>
                  Show {here.site.name} again
                </button>
              </p>
            )}
            <TimeControl track={riverTrack} index={index} onIndex={setIndex} />
          </div>
        )}

        <div className={here ? 'scout-guide above-river' : 'scout-guide'} data-tour="scout">
          <button type="button" className="scout-face" aria-expanded={!quiet} aria-label={quiet ? 'Show what Scout is saying' : 'Hide what Scout is saying'} onClick={() => setQuiet(!quiet)}>
            <Mascot state={state} />
          </button>
          {!quiet && (
            <div className="atlas-talk">
              <Bubble
                text={answer ? answer.text : line}
                answer={answer}
                thinking={waiting}
                step={step}
                ideas={ideas}
                onAsk={(chip) => {
                  if (chip === ASK_SPOT) void ask(`How much Sun and Earth does this spot get in ${monthLabel(place.month)}?`)
                  else if (chip === OPEN_POINT && exactPoint) window.location.assign(exactPoint)
                  else if (chip === backToSite) setPicked(null)
                  else void ask(chip)
                }}
                onOpen={(hash) => {
                  const to = placeFrom(hash)
                  if (to) {
                    setPicked(null)
                    setPlace(to)
                    setGoal((last) => ({ id: last.id + 1, to: 'site' }))
                  }
                  setShowAnswer(false)
                }}
                onDismiss={() => setShowAnswer(false)}
                sound={voice.sound}
                onSound={voice.setSound}
                unsaid={voice.sound && voice.failed}
              />
              <form className="atlas-ask" onSubmit={submit}>
                <input
                  aria-label="Ask Scout a question"
                  placeholder={site ? `Ask Scout about ${site.name}` : 'Ask Scout'}
                  maxLength={MAX_QUESTION_CHARS}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" disabled={waiting || cooldown.secondsLeft > 0 || draft.trim() === ''}>
                  {cooldown.secondsLeft > 0 ? `Wait ${cooldown.secondsLeft} s` : 'Ask'}
                </button>
              </form>
              <p className="atlas-kept">Questions may be kept to improve Scout, never with who asked. Don’t type anything private. Scout’s mark and voice are AI-generated.</p>
            </div>
          )}
        </div>
      </main>
      {touring && <AtlasTour onClose={() => setTouring(false)} />}
    </div>
  )
}
