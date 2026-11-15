import type { FeatureGuide, TourFile } from '../lib/tour'
import tourFile from '../sightline/tour.json'
import type { GuideVideos } from '../sightline/useGuideVideos'
import { useEffect, useRef, useState } from 'react'
import { useLightChecks } from '../data/lightChecks'
import { useQuestionCounts } from '../data/questionCounts'
import type { ScenarioData } from '../data/scenarioData'
import { copilotModel, useServiceStatus } from '../data/serviceStatus'
import { useRange } from '../data/useRange'
import { QuestionCounts } from '../components/QuestionCounts'
import { ServiceStatus } from '../components/ServiceStatus'
import { chapterTime } from '../lib/guideVideo'
import { wholePct } from '../lib/verdict'
import { DataSources } from './DataSources'
import { GuideChallenge } from './guide/GuideChallenge'
import { GUIDE_STEPS, type GuideStepId, GuideStep } from './guide/GuideParts'
import { GuideProof } from './guide/GuideProof'
import { GuideScout } from './guide/GuideScout'
import { GuideSolution, type VerdictOnShow } from './guide/GuideSolution'
import { GuideStack } from './guide/GuideStack'
import './how.css'

interface Props {
  /** The site and month on screen, for the live numbers; null while it loads. */
  data: ScenarioData | null
  siteCount: number
  backLabel: string
  onBack: () => void
  /** Start Scout's tour of the screen (Sightline only: the tour drives that screen). */
  onTour?: () => void
  /** The visitor has taken the tour before: the button offers it again. */
  tourTaken?: boolean
  /** The feature guides (short tours of one feature each), and how to start one by its id. Sightline only. */
  guides?: FeatureGuide[]
  onGuide?: (id: string) => void
  /** The Guide's videos that exist (the walkthrough, its chapters, the 30-second demo); a player shows only for one that does. */
  videos?: GuideVideos | null
  /** Open with the walkthrough on screen: the tour's last step leads here. */
  openAtVideo?: boolean
  /**
   * Why the site of the scenario on show is hard: a few sentences from that site's own figures
   * (lib/explainer.ts `whyHard`); null while they load, and on a page with no scenario.
   */
  why?: string[] | null
  /** Open at "Why this site is hard": Scout's ready idea leads here. */
  openAtWhy?: boolean
  /** The verdict on the scenario on show, as the plan gives it; null while it loads, and on a page with no plan. */
  verdict?: VerdictOnShow | null
}

const TOUR = tourFile as TourFile

/**
 * The Guide, as one story: where to start (the tour and the videos), the challenge, the data, the
 * solution, the proof, Scout, and what the site runs on. A bar that stays in sight holds the way back
 * and a link to each part.
 */
export function HowItWorks({ data, siteCount, backLabel, onBack, onTour, tourTaken = false, guides = [], onGuide, videos = null, openAtVideo = false, why = null, openAtWhy = false, verdict = null }: Props) {
  // Arriving from a scrolled page would otherwise open this one part-way down.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  // One player at a time, and none until a video is asked for. A press on a video's button shows its
  // player and starts it; the same press again puts it away. Nothing plays without a press.
  const [playing, setPlaying] = useState<'walkthrough' | 'demo' | null>(null)
  const player = useRef<HTMLDivElement>(null)
  const film = useRef<HTMLVideoElement>(null)
  /** Start the player that has just been put on screen, once it is there. */
  const start = useRef(false)
  const onScreen = playing === 'walkthrough' ? (videos?.walkthrough ?? null) : playing === 'demo' ? (videos?.demo ?? null) : null
  const watch = (which: 'walkthrough' | 'demo') => {
    start.current = playing !== which
    setPlaying(playing === which ? null : which)
  }
  useEffect(() => {
    if (!onScreen || !start.current) return
    start.current = false
    player.current?.scrollIntoView({ block: 'nearest' })
    // A browser that refuses to start it leaves the player there, with its own play control.
    void film.current?.play().catch(() => {})
  }, [onScreen])
  // From the tour's last step the sheet opens with the walkthrough on screen, in view.
  const hasWalkthrough = Boolean(videos?.walkthrough)
  useEffect(() => {
    if (!openAtVideo || !hasWalkthrough) return
    start.current = true
    setPlaying('walkthrough')
  }, [openAtVideo, hasWalkthrough])
  // From Scout's idea the sheet opens at "Why this site is hard": in view, and where the keyboard is.
  const whyHere = useRef<HTMLElement>(null)
  const hasWhy = Boolean(why && why.length > 0)
  useEffect(() => {
    if (!openAtWhy || !hasWhy) return
    whyHere.current?.focus({ preventScroll: true })
    whyHere.current?.scrollIntoView({ block: 'start' })
  }, [openAtWhy, hasWhy])
  /** A chapter was pressed: the video goes there and plays on. */
  const jump = (at: number) => {
    if (!film.current) return
    film.current.currentTime = at
    void film.current.play().catch(() => {})
  }

  // The bar's links: each brings its part to the top, under the bar, and the part in view is marked.
  // Buttons, not links: the address belongs to the plan on screen.
  const page = useRef<HTMLElement>(null)
  const [part, setPart] = useState<GuideStepId | null>(null)
  const go = (id: GuideStepId) => page.current?.querySelector(`#${id}`)?.scrollIntoView({ block: 'start' })
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !page.current) return
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setPart(entry.target.id as GuideStepId)
      },
      { rootMargin: '-30% 0px -60% 0px' },
    )
    for (const step of GUIDE_STEPS) {
      const section = page.current.querySelector(`#${step.id}`)
      if (section) watcher.observe(section)
    }
    return () => watcher.disconnect()
  }, [])
  // On a phone the links scroll sideways: the one for the part in view is brought into sight.
  useEffect(() => {
    const link = page.current?.querySelector<HTMLElement>('.how-steps [aria-current="true"]')
    const row = link?.parentElement
    if (link && row) row.scrollLeft = link.offsetLeft - row.offsetLeft - 8
  }, [part])

  // The years come from the data's own description of what it covers, not from this page.
  const range = useRange()
  const span = range ? `${range.first_year} to ${range.last_year}` : 'every year of the data'
  const light = useLightChecks()

  const counts = useQuestionCounts()
  const services = useServiceStatus()
  const scoutModel = copilotModel(services)
  const sunShare = data ? wholePct(data.summary.pct_sun) : '…'

  return (
    <main className="how" ref={page}>
      <header className="how-top">
        <button type="button" onClick={onBack}>
          ← {backLabel}
        </button>
        <nav className="how-steps" aria-label="On this page">
          {GUIDE_STEPS.map((step) => (
            <button key={step.id} type="button" aria-current={part === step.id ? 'true' : undefined} onClick={() => go(step.id)}>
              {step.number && <b>{step.number}</b>}
              {step.name}
            </button>
          ))}
        </nav>
      </header>

      {/* Start here: what the page is, and everything about learning the app in one place. The tour,
          and the two videos once their files exist. One player at a time, started only by a press, captions on. */}
      <section className="how-start" aria-labelledby="how-title">
        <p className="how-kicker">Guide</p>
        <h1 id="how-title">Where to land on the Moon, and when.</h1>
        <p className="how-lede">
          Sightline answers one question: if a lander touches down here, at this hour, will it have sunlight for power and Earth in view for radio? This page gives the problem,
          the data, the tool and the proof, in that order.
        </p>
        {(onTour || videos?.walkthrough || videos?.demo) && (
          <div className="how-start-ways">
            {onTour && (
              <button type="button" className="how-tour-button" onClick={onTour}>
                {tourTaken ? 'Take the tour again' : 'Take the tour'}
              </button>
            )}
            {videos?.walkthrough && (
              <button type="button" className="how-watch" aria-pressed={playing === 'walkthrough'} onClick={() => watch('walkthrough')}>
                Watch the walkthrough
              </button>
            )}
            {videos?.demo && (
              <button type="button" className="how-watch" aria-pressed={playing === 'demo'} onClick={() => watch('demo')}>
                30-second demo
              </button>
            )}
          </div>
        )}
        {onTour && <p className="how-start-note">The tour is interactive: Scout walks you through the real screen in about a minute.</p>}
        {onScreen && (
          <div ref={player} className="how-video">
            {/* Recorded from the site itself. The narration is an AI-generated voice, and the captions say every line. */}
            <video key={onScreen.file} ref={film} controls playsInline preload="none" poster={onScreen.poster} aria-label={playing === 'demo' ? 'Sightline in 30 seconds' : 'Sightline walkthrough'}>
              <source src={onScreen.file} type="video/mp4" />
              <track kind="captions" src={onScreen.captions} srcLang="en" label="English" default />
            </video>
            {playing === 'walkthrough' && videos && videos.chapters.length > 0 && (
              <ol className="how-chapters" aria-label="Chapters">
                {videos.chapters.map((chapter) => (
                  <li key={chapter.at}>
                    <button type="button" onClick={() => jump(chapter.at)}>
                      <span>{chapterTime(chapter.at)}</span> {chapter.title}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <p className="how-caption">Recorded from this site. The narration is an AI-generated voice; the captions say every line.</p>
          </div>
        )}
      </section>

      <GuideChallenge why={why} whyHere={whyHere} onGo={go} />

      <GuideStep id="how-data" kicker="Step 2" title="Gather the data" intro="Every number on this site is computed from public data by our own code. Nothing is typed in by hand, and nothing is made up by an AI. Two things do most of the work: the shape of the ground, and where the Sun and Earth are.">
        <DataSources />
      </GuideStep>

      <GuideSolution data={data} siteCount={siteCount} span={span} range={range} light={light} verdict={verdict} tour={TOUR} guides={guides} onGuide={onGuide} />

      <GuideProof data={data} span={span} light={light} />

      <GuideScout sunShare={sunShare} model={scoutModel} year={data ? data.month.slice(0, 4) : null}>
        <QuestionCounts counts={counts} />
      </GuideScout>

      <GuideStack>
        <ServiceStatus services={services} />
      </GuideStack>

      <footer className="how-foot">
        <p>Sightline is a hackathon project. Do not use it for real mission decisions.</p>
        <p>
          Built by team Shackleton Station for the NASA Space Apps Challenge 2026. Not affiliated with or endorsed by NASA. Results are a first pass for learning and comparison,
          not mission planning advice.
        </p>
        <button type="button" onClick={onBack}>
          ← {backLabel}
        </button>
      </footer>
    </main>
  )
}
