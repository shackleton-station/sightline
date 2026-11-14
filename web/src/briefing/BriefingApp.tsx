import { useEffect, useMemo, useState } from 'react'
import { AtlasStage } from '../atlas/AtlasStage'
import { LayerKey } from '../atlas/LayerKey'
import { useLightGrid } from '../atlas/useLightGrid'
import { SiteTabs } from '../components/SiteTabs'
import type { SiteInfo } from '../data/contract'
import { useScenario } from '../data/useScenario'
import { setAddressBar } from '../lib/address'
import { cellAt, cellCenter } from '../lib/lightGrid'
import { DEFAULT_REQUIREMENTS, type Requirements } from '../lib/mission'
import { riverTime } from '../lib/river'
import { DEFAULT_VIEW } from '../lib/siteTabs'
import { decodeView, encodeView, type ViewState } from '../lib/urlState'
import { usePlannerData } from '../planner/usePlannerData'
import { missionWords } from '../planner/words'
import { SoundIcon } from '../scout/Bubble'
import { Mascot } from '../scout/Mascot'
import { buildBriefing, type Chapter, monthWords, type Recommendation, whenWords } from './script'
import { usePlayer } from './usePlayer'

/** The mission a link with no limits is briefed for: the app's example one. */
const LIMITS: Requirements = DEFAULT_REQUIREMENTS
const VALIDATION_URL = `${import.meta.env.BASE_URL}data/light/validation.json`

/** The part of the light grid's validation file a caption quotes. */
interface ValidationFile {
  pgda: { ours: { sun_mean_disk: { all: { n: number; mean_abs: number } } } }
}

/** A link to another tab, opened on a site, month and hour with this briefing's mission. */
function tabLink(path: string, view: ViewState, site: string, month: string, index: number): string {
  return `${path}${encodeView({ ...view, a: { site, month }, b: null, index })}`
}

/**
 * The briefing: the two-minute story of one month at the south pole, told on the Atlas's own
 * picture and ending on a landing to plan on. Scout says each caption; every number in one is
 * counted from the pipeline's data by `script.ts`.
 */
export function BriefingApp() {
  const view = useMemo(() => decodeView(window.location.hash, LIMITS) ?? (decodeView(DEFAULT_VIEW, LIMITS) as ViewState), [])
  const month = view.a.month
  const data = usePlannerData()
  const light = useLightGrid(month, false)
  const meta = light.meta
  const [validation, setValidation] = useState<{ pixels: number; sunMeanAbs: number } | null | undefined>(undefined)
  useEffect(() => {
    fetch(VALIDATION_URL)
      .then((response) => (response.ok ? (response.json() as Promise<ValidationFile>) : null))
      .then((file) => setValidation(file ? { pixels: file.pgda.ours.sun_mean_disk.all.n, sunMeanAbs: file.pgda.ours.sun_mean_disk.all.mean_abs } : null))
      .catch(() => setValidation(null))
  }, [])

  // The sites the story is about: the listed ones the light grid holds (the south-pole ridges).
  const candidates = useMemo(() => {
    if (data.status !== 'ready' || meta === undefined) return null
    const inGrid = data.sites.filter(({ site }) => (meta ? cellAt(meta, site.lat, site.lon) !== null : site.group === 'South pole ridges'))
    return inGrid.length > 0 ? inGrid : data.sites.filter(({ site }) => site.lat < -85)
  }, [data, meta])
  const focus = candidates ? (candidates.find(({ site }) => site.id === view.a.site) ?? candidates[0])?.site ?? null : null
  const opening = useScenario(focus, month)

  // The script is written once, when everything it counts from has arrived, and then kept: the
  // last chapter may show a later month, and the story must not be rewritten under the player.
  const gridSettled = light.status !== 'loading'
  const ready = candidates && focus && opening.data && opening.data.site.id === focus.id && opening.data.month === month && gridSettled && validation !== undefined
  const written = useMemo(
    () =>
      ready
        ? buildBriefing({
            focus,
            month,
            hour: view.index,
            track: opening.data?.track ?? [],
            requirements: view.requirements,
            candidates,
            grid: meta && light.month ? { meta, month: light.month } : null,
            validation: validation ?? null,
          })
        : null,
    [ready, focus, month, view, opening.data, candidates, meta, light.month, validation],
  )
  const [script, setScript] = useState<{ chapters: Chapter[]; recommendation: Recommendation | null } | null>(null)
  if (!script && written) setScript(written)

  const player = usePlayer(script?.chapters ?? [])
  const chapter = player.chapter
  // The scene shows the chapter's own site and month; the last chapter may be in a later month.
  const sceneSite: SiteInfo | null = (chapter && candidates?.find(({ site }) => site.id === chapter.siteId)?.site) ?? focus
  const sceneMonth = chapter?.month ?? month
  const scene = useScenario(sceneSite, sceneMonth)
  // The briefing's story is about the fine square ("this square is 123 km"), so its picture shows
  // that square alone, without the wider grid the Atlas draws round it.
  const sceneLight = useLightGrid(sceneMonth, false)
  const track = scene.data && scene.data.site.id === sceneSite?.id && scene.data.month === sceneMonth ? scene.data.track : null
  const hour = track ? Math.min(player.hour, track.length - 1) : 0
  const pin = chapter?.pin && meta && sceneSite ? cellAt(meta, sceneSite.lat, sceneSite.lon) : null
  const goal = useMemo(() => ({ id: player.index + 1, to: chapter?.camera ?? ('moon' as const) }), [player.index, chapter?.camera])
  const allSites = data.status === 'ready' ? data.sites.map(({ site }) => site) : []

  // Space plays and pauses; the arrows move between chapters.
  const { status, index, play, pause, go } = player
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return
      if (event.key === ' ') {
        event.preventDefault()
        if (status === 'playing') pause()
        else play()
      } else if (event.key === 'ArrowRight' && status !== 'start') go(index + 1)
      else if (event.key === 'ArrowLeft' && status !== 'start') go(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, index, play, pause, go])

  const address = focus ? tabLink('', view, focus.id, month, view.index) : ''
  useEffect(() => {
    if (address) setAddressBar(address)
  }, [address])

  const failed = data.status === 'error' || opening.error !== null
  const pick = script?.recommendation ?? null
  const count = script?.chapters.length ?? 0

  return (
    <div className="scout atlas briefing">
      <SiteTabs current="briefing" view={address} />
      <main className="scout-stage atlas-stage">
        <AtlasStage
          sites={allSites}
          site={sceneSite}
          sun={track ? track[hour].sun_vec_me : null}
          hour={hour}
          layer={chapter?.layer ?? 'light'}
          light={sceneLight}
          picked={pin && meta ? cellCenter(meta, pin) : null}
          goal={goal}
          onPick={() => {}}
          onChoose={() => {}}
        />

        {chapter && status !== 'start' && (
          <div className="briefing-when">
            <p className="briefing-clock">{track ? riverTime(track[hour].t) : monthWords(sceneMonth)}</p>
            {meta && <LayerKey layer={chapter.layer} />}
          </div>
        )}

        {status === 'start' && (
          <section className="briefing-card" aria-labelledby="briefing-title">
            <p className="scout-kicker">Two minutes · {count > 0 ? `${count} chapters` : 'getting the data'}</p>
            <h1 id="briefing-title">The briefing: {monthWords(month)} at the Moon's south pole</h1>
            <p>Where the Sun and Earth are in view, how sure that is, and a landing to plan on.</p>
            <p className="briefing-mission">{missionWords(view.requirements)}</p>
            {failed ? (
              <p className="briefing-trouble" role="alert">
                The data didn't load. Check the connection and reload the page.
              </p>
            ) : (
              <div className="briefing-go">
                <button type="button" className="briefing-play" disabled={!script} onPointerEnter={player.warm} onFocus={player.warm} onClick={play}>
                  {script ? '▶ Play the briefing' : 'Getting the data…'}
                </button>
                <label className="briefing-sound">
                  <input type="checkbox" checked={player.sound} onChange={(event) => player.setSound(event.target.checked)} /> Scout says it aloud
                </label>
              </div>
            )}
            <p className="briefing-small">
              Every number is counted from the pipeline's data when you press play. Change the mission in the <a href={`/planner/${address}`}>Planner</a>. Scout's mark
              and voice are AI-generated.
            </p>
          </section>
        )}

        {chapter && status !== 'start' && (
          <div className="briefing-deck">
            <div className="briefing-say">
              <span className="briefing-face">
                <Mascot state={null} />
              </span>
              <div className="scout-bubble own briefing-caption" aria-live={player.sound ? 'off' : 'polite'}>
                <p className="scout-name">
                  {index + 1} of {count} · {chapter.title}
                </p>
                <p className="scout-says">{chapter.caption}</p>
                {player.unsaid && <p className="scout-unsaid">I couldn't say that one aloud here, so it is only written.</p>}
                {status === 'done' && pick && (
                  <div className="scout-go">
                    <a href={tabLink('/planner/', view, pick.site.id, pick.month, pick.index)}>Open this landing in the Planner →</a>
                    <a href={tabLink('/atlas/', view, pick.site.id, pick.month, pick.index)}>Explore it in the Atlas →</a>
                    <a href={tabLink('/scout/', view, pick.site.id, pick.month, pick.index)}>Ask Scout about it →</a>
                  </div>
                )}
                {status === 'done' && pick && <p className="briefing-small">Landing: {whenWords(pick.landing.t)}. {pick.reasons.join('. ')}.</p>}
              </div>
            </div>
            <div className="briefing-controls">
              <button type="button" aria-label="Previous chapter" disabled={index === 0} onClick={() => go(index - 1)}>
                ‹
              </button>
              {/* On a phone only the signs show, so the chapter bars fit on the same row. */}
              {status === 'playing' ? (
                <button type="button" className="briefing-main" aria-label="Pause" onClick={pause}>
                  ❚❚<span className="briefing-word"> Pause</span>
                </button>
              ) : (
                <button type="button" className="briefing-main" aria-label={status === 'done' ? 'Play again' : 'Play'} onClick={play}>
                  {status === 'done' ? '↺' : '▶'}
                  <span className="briefing-word">{status === 'done' ? ' Play again' : ' Play'}</span>
                </button>
              )}
              <button type="button" aria-label="Next chapter" disabled={index + 1 >= count} onClick={() => go(index + 1)}>
                ›
              </button>
              <ol className="briefing-steps" aria-label="Chapters">
                {script?.chapters.map((step, at) => (
                  <li key={step.id}>
                    <button type="button" aria-label={`Chapter ${at + 1}: ${step.title}`} aria-current={at === index ? 'step' : undefined} onClick={() => go(at)}>
                      <span style={{ width: `${at < index || status === 'done' ? 100 : at === index ? player.progress * 100 : 0}%` }} />
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" className="briefing-mute" aria-label="Sound" aria-pressed={player.sound} onClick={() => player.setSound(!player.sound)}>
                <SoundIcon on={player.sound} />
                <span className="briefing-word">Sound {player.sound ? 'on' : 'off'}</span>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
