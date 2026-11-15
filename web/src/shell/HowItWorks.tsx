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
import { Flow, type FlowStep, GUIDE_STEPS, type GuideStepId, GuideStep } from './guide/GuideParts'
import { GuideProof } from './guide/GuideProof'
import { GuideSolution, type VerdictOnShow } from './guide/GuideSolution'
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

const VISIT: FlowStep[] = [
  { name: 'You', does: 'open lunarsightline.com', tech: 'Cloud DNS · Cloud Domains' },
  { name: 'Load balancer', does: 'ends HTTPS and serves cached files from near you', tech: 'Global Application Load Balancer · Cloud CDN · managed certificate' },
  { name: 'Web server', does: 'sends the app, streams terrain and answers questions', tech: 'Cloud Run · Node 22 · Hono · Docker' },
  { name: 'Storage, memory and AI', does: 'hold the terrain, the shared counts and saved plans, and run the language model', tech: 'Cloud Storage · Redis (Memorystore) · Firestore · Claude (Anthropic API)' },
]

const SHIP: FlowStep[] = [
  { name: 'A change', does: 'is proposed and reviewed', tech: 'GitHub pull request' },
  { name: 'Checks', does: 'type-check, test and build everything', tech: 'GitHub Actions · vitest · pytest · ruff' },
  { name: 'Sign-in with no key', does: 'GitHub proves which repository and branch it is', tech: 'Workload Identity Federation' },
  { name: 'Deploy in steps', does: 'test the new version with no visitors, give it a tenth of them, then all; go back if anything fails', tech: 'Artifact Registry · Cloud Run canary · automatic rollback' },
]

const COUNT: FlowStep[] = [
  { name: 'A question is answered', does: 'and a small note about it is kept before the answer leaves', tech: 'an outbox in Redis · the event has its own id' },
  { name: 'A queue', does: 'holds the note until every reader has it, and sends it again if one fails', tech: 'Pub/Sub · at-least-once delivery · retries, then a dead-letter topic' },
  { name: 'A worker', does: 'that no visitor can reach counts it, once, however often it arrives', tech: 'Cloud Run, private · its own identity · one atomic write' },
  { name: 'The day’s counts', does: 'are kept in several pieces, and this page adds them up', tech: 'Firestore · sharded counters · read-only for the web server' },
]

const REBUILD: FlowStep[] = [
  { name: 'NASA data', does: 'is downloaded once and kept out of the repository', tech: 'LOLA terrain · SPICE kernels · PGDA maps' },
  { name: 'The pipeline', does: 'works out every site and hour, then checks itself', tech: 'Python 3.12 · SpiceyPy · NumPy · a Compute Engine VM' },
  { name: 'Small results', does: 'are saved with the code, so every change is reviewed', tech: 'JSON in Git' },
  { name: 'Terrain tiles', does: 'are too big for Git, so they go to a private bucket', tech: 'Cloud Storage · gcloud storage rsync' },
]

const STACK: { layer: string; items: string[] }[] = [
  { layer: 'In your browser', items: ['React 19', 'TypeScript', 'Vite', 'Three.js (WebGL2)', 'our own terrain-lighting shader', 'D3'] },
  { layer: 'Server', items: ['Node 22', 'Hono', 'Docker', 'Cloud Run'] },
  { layer: 'Google Cloud', items: ['Cloud Storage', 'Memorystore (Redis)', 'Firestore', 'Load Balancing', 'Cloud CDN', 'Cloud DNS', 'Cloud Armor', 'Pub/Sub', 'BigQuery', 'Cloud Trace', 'Artifact Registry', 'Cloud Monitoring'] },
  { layer: 'Language model', items: ['Claude on the Anthropic API', 'signed in by workload identity federation, no stored key'] },
  { layer: 'Built and shipped with', items: ['Terraform', 'GitHub Actions', 'Workload Identity Federation'] },
  { layer: 'Data pipeline', items: ['Python 3.12', 'SpiceyPy (NAIF SPICE)', 'NumPy', 'Numba', 'Rasterio', 'PyProj', 'uv'] },
]

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
  const copilot: FlowStep[] = [
    { name: 'You ask', does: '“How sunny is it here this month?”', tech: 'POST /api/chat' },
    { name: 'The model picks a tool', does: 'it may only call our own read-only functions', tech: 'Claude tool use: month_summary' },
    { name: 'Our code computes', does: `Sun up: ${sunShare}`, tech: 'the same function the page uses' },
    { name: 'The model writes', does: '“The Sun is up {{r1.pct_sun}} of the month.”', tech: 'a reference, never a number' },
    { name: 'The server fills it in', does: `“The Sun is up ${sunShare} of the month.”`, tech: 'a reply with a typed digit is refused' },
  ]

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

      <GuideStep
        id="how-challenge"
        kicker="Step 1"
        title="Understand the challenge"
        intro="Near the Moon’s south pole the Sun and Earth never climb. They skim the horizon, so the hills around a site decide when it has sunlight for power and Earth in view for radio."
      >
        {/* Why the site on show is hard, in a few sentences made of that site's own figures. */}
        {why && why.length > 0 && (
          <section ref={whyHere} className="how-why" aria-labelledby="how-why-title" tabIndex={-1}>
            <h3 id="how-why-title">Why this site is hard</h3>
            <ul className="how-why-lines">
              {why.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="how-start-note">This site’s own figures, for the scenario on show.</p>
          </section>
        )}
      </GuideStep>

      <GuideStep id="how-data" kicker="Step 2" title="Gather the data" intro="Every number on this site is computed from public data by our own code. Nothing is typed in by hand, and nothing is made up by an AI.">
        <DataSources />
      </GuideStep>

      <GuideSolution data={data} siteCount={siteCount} span={span} range={range} light={light} verdict={verdict} tour={TOUR} guides={guides} onGuide={onGuide} />

      <GuideProof data={data} span={span} light={light} />

      <GuideStep id="how-scout" kicker="Your guide" title="Scout" intro="A language model is good with words and unreliable with numbers. So Scout’s is never allowed to write one.">
        <Flow steps={copilot} label="How Scout answers" />
        <p className="how-caption">
          The same rule covers his buttons: the server rebuilds each one from parts it has checked, so the model can only send you to a real site, month and hour.
        </p>
        <p className="how-caption">
          Two things are made by AI, and carry an “AI” tag where they appear: Scout’s answers, which a language model writes from our numbers (his voice is synthetic too), and
          Scout’s mark, the round badge beside his name. Scout’s answers and his mark are AI-generated.
        </p>
        {/* Which model, from what Scout's service reports right now, so this cannot go stale. */}
        <p className="how-caption how-scout-model">
          Scout is Anthropic’s Claude{scoutModel ? ` (${scoutModel})` : ''}. He reads the same data as the screen, through the service’s read-only tools, and never works out a number himself:
          the server fills in every number, date and time from that data.
        </p>
        <h3>Questions to Scout today</h3>
        <QuestionCounts counts={counts} />
      </GuideStep>

      <GuideStep id="how-stack" kicker="Under the hood" title="What it runs on" intro="The whole site is described in code, so it can be rebuilt from nothing in minutes. There are no passwords or keys anywhere in it.">
        <h3>When you open the site</h3>
        <Flow steps={VISIT} label="What happens when you open the site" />
        <h3>When we change it</h3>
        <Flow steps={SHIP} label="How a change reaches the site" />
        <h3>When the data is rebuilt</h3>
        <Flow steps={REBUILD} label="How the data is rebuilt" />
        <p className="how-caption">
          Every box above is declared in Terraform. An uptime check emails us if the site stops answering, an objective (99.5% of requests succeed) alerts us when failures pile
          up, every request is traced so we can see where a slow one spent its time, and a budget alert watches the spending.
        </p>
        <h3>When someone asks Scout a question</h3>
        <Flow steps={COUNT} label="How a question is counted" />
        <h3>The services, right now</h3>
        <p className="how-caption">
          The site is several services behind one address. The load balancer sends each path to its own, so when one fails the others keep going. The web server asks the others
          how they are, proving who it is with a short-lived token from Google, and gives each one second to answer.
        </p>
        <ServiceStatus services={services} />
        <h3>The stack</h3>
        <dl className="how-stack">
          {STACK.map(({ layer, items }) => (
            <div key={layer}>
              <dt>{layer}</dt>
              <dd>
                {items.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </GuideStep>

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
