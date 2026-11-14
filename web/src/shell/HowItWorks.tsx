import type { TourFile } from '../lib/tour'
import tourFile from '../sightline/tour.json'
import type { TutorialVideo } from '../sightline/useTutorialVideo'
import { Fragment, type ReactNode, useEffect, useRef } from 'react'
import { useLightChecks } from '../data/lightChecks'
import { useQuestionCounts } from '../data/questionCounts'
import type { ScenarioData } from '../data/scenarioData'
import { copilotModel, useServiceStatus } from '../data/serviceStatus'
import { useRange } from '../data/useRange'
import { QuestionCounts } from '../components/QuestionCounts'
import { ServiceStatus } from '../components/ServiceStatus'
import { TrustNotes } from '../components/TrustNotes'
import { monthLabel } from '../lib/months'
import { pct } from '../lib/verdict'
import { DataSources } from './DataSources'
import './how.css'

interface Props {
  /** The site and month on screen, for the live numbers; null while it loads. */
  data: ScenarioData | null
  siteCount: number
  backLabel: string
  onBack: () => void
  /** Start Scout's tour of the screen (Sightline only: the tour drives that screen). */
  onTour?: () => void
  /** The tutorial video's files, once they exist; the player shows only then. */
  video?: TutorialVideo | null
  /** Open with the video in view: the tour's last step leads here. */
  openAtVideo?: boolean
}

const TOUR = tourFile as TourFile

interface Step {
  name: string
  /** One plain line. */
  does: string
  /** The exact technology, for engineers. */
  tech: string
}

/** Boxes joined by arrows: across on a wide screen, down on a phone. Real text, so it reflows and reads aloud. */
function Flow({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className="how-flow" aria-label={label}>
      {steps.map((step, i) => (
        <Fragment key={step.name}>
          {i > 0 && (
            <li className="how-arrow" aria-hidden="true">
              →
            </li>
          )}
          <li className="how-node">
            <strong>{step.name}</strong>
            <span>{step.does}</span>
            <code>{step.tech}</code>
          </li>
        </Fragment>
      ))}
    </ol>
  )
}

function Act({ number, title, lede, children }: { number: number; title: string; lede: string; children: ReactNode }) {
  return (
    <section className="how-act" aria-labelledby={`how-act-${number}`}>
      <p className="how-number">Part {number}</p>
      <h2 id={`how-act-${number}`}>{title}</h2>
      <p className="how-lede">{lede}</p>
      {children}
    </section>
  )
}

const VISIT: Step[] = [
  { name: 'You', does: 'open shackletonstation.dev', tech: 'Cloud DNS · Cloud Domains' },
  { name: 'Load balancer', does: 'ends HTTPS and serves cached files from near you', tech: 'Global Application Load Balancer · Cloud CDN · managed certificate' },
  { name: 'Web server', does: 'sends the app, streams terrain and answers questions', tech: 'Cloud Run · Node 22 · Hono · Docker' },
  { name: 'Storage, memory and AI', does: 'hold the terrain, the shared counts and saved plans, and run the language model', tech: 'Cloud Storage · Redis (Memorystore) · Firestore · Claude (Anthropic API)' },
]

const SHIP: Step[] = [
  { name: 'A change', does: 'is proposed and reviewed', tech: 'GitHub pull request' },
  { name: 'Checks', does: 'type-check, test and build everything', tech: 'GitHub Actions · vitest · pytest · ruff' },
  { name: 'Sign-in with no key', does: 'GitHub proves which repository and branch it is', tech: 'Workload Identity Federation' },
  { name: 'Deploy in steps', does: 'test the new version with no visitors, give it a tenth of them, then all; go back if anything fails', tech: 'Artifact Registry · Cloud Run canary · automatic rollback' },
]

const COUNT: Step[] = [
  { name: 'A question is answered', does: 'and a small note about it is kept before the answer leaves', tech: 'an outbox in Redis · the event has its own id' },
  { name: 'A queue', does: 'holds the note until every reader has it, and sends it again if one fails', tech: 'Pub/Sub · at-least-once delivery · retries, then a dead-letter topic' },
  { name: 'A worker', does: 'that no visitor can reach counts it, once, however often it arrives', tech: 'Cloud Run, private · its own identity · one atomic write' },
  { name: 'The day’s counts', does: 'are kept in several pieces, and this page adds them up', tech: 'Firestore · sharded counters · read-only for the web server' },
]

const REBUILD: Step[] = [
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

/** How the numbers are made, why to trust them, what the site runs on, and how the co-pilot stays honest. */
export function HowItWorks({ data, siteCount, backLabel, onBack, onTour, video = null, openAtVideo = false }: Props) {
  // Arriving from a scrolled page would otherwise open this one part-way down.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  // From the tour's last step it opens at the video.
  const player = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (openAtVideo && video) player.current?.scrollIntoView({ block: 'center' })
  }, [openAtVideo, video])

  // The years come from the data's own description of what it covers, not from this page.
  const range = useRange()
  const span = range ? `${range.first_year} to ${range.last_year}` : 'every year of the data'
  const directions = data ? String(data.horizon.length) : 'hundreds of'
  const height = data ? `${data.summary.obs_height_m} m` : 'a lander’s height'

  const pipeline: Step[] = [
    { name: 'NASA data', does: 'the shape of the Moon, and where the Sun and Earth are', tech: 'LOLA laser altimeter terrain · NAIF SPICE kernels' },
    { name: 'The horizon', does: `how high the land stands in ${directions} directions around each site`, tech: 'ray march to 150 km over the terrain, on a sphere' },
    { name: 'Every hour', does: `is the Sun or Earth above that horizon, ${height} off the ground?`, tech: 'SPICE positions in the MOON_ME frame, with light time' },
    { name: 'The answer', does: `hourly visibility for ${siteCount} sites, ${span}`, tech: 'static JSON and terrain tiles' },
  ]

  // The Atlas's map of the polar ground: the same calculation, at every pixel. Its numbers are read
  // from the pipeline's own files, like every other number here.
  const light = useLightChecks()
  const everyPixel: Step[] = [
    { name: 'The same calculation', does: 'the horizon and the hourly check a listed site gets', tech: `${directions} directions, out to 200 km, ${height} above the ground` },
    { name: 'At every pixel', does: light ? `each ${light.pixelM} m of a ${light.widthKm} km square on the south pole${light.wide ? `, and each ${light.wide.pixelM} m of a ${light.wide.widthKm} km one around it` : ''}` : 'every pixel of a square on the south pole', tech: `${light ? `${light.millionsOfPixels.toFixed(1)} million` : 'millions of'} pixels · Python compiled with Numba` },
    { name: 'Kept as changes', does: 'a pixel’s month is the hours its Sun and Earth come and go', tech: 'one file of a few megabytes a month · Cloud Storage' },
    { name: 'Drawn by your graphics card', does: 'moving time changes one number; nothing is sent again', tech: 'integer textures · a WebGL2 shader in Three.js' },
  ]

  const counts = useQuestionCounts()
  const services = useServiceStatus()
  const scoutModel = copilotModel(services)
  const sunShare = data ? pct(data.summary.pct_sun) : '…'
  const copilot: Step[] = [
    { name: 'You ask', does: '“How sunny is it here this month?”', tech: 'POST /api/chat' },
    { name: 'The model picks a tool', does: 'it may only call our own read-only functions', tech: 'Claude tool use: month_summary' },
    { name: 'Our code computes', does: `Sun up: ${sunShare}`, tech: 'the same function the page uses' },
    { name: 'The model writes', does: '“The Sun is up {{r1.pct_sun}} of the month.”', tech: 'a reference, never a number' },
    { name: 'The server fills it in', does: `“The Sun is up ${sunShare} of the month.”`, tech: 'a reply with a typed digit is refused' },
  ]

  return (
    <main className="how">
      <header className="how-top">
        <button type="button" onClick={onBack}>
          ← {backLabel}
        </button>
      </header>

      {/* First, how to use the screen: the same steps Scout's tour walks through, from the same file. */}
      <section className="how-use" aria-labelledby="how-use-title">
        <p className="how-kicker">Start here</p>
        <h2 id="how-use-title">How to use Sightline</h2>
        <ol className="how-use-steps">
          {TOUR.steps.map((step) => (
            <li key={step.id}>
              <b>{step.title}.</b> {step.say}
            </li>
          ))}
        </ol>
        {onTour && (
          <p className="how-use-tour">
            <button type="button" className="how-tour-button" onClick={onTour}>
              Take the tour
            </button>{' '}
            Scout walks you through these on the real screen, in about a minute.
          </p>
        )}
        {video && (
          <div ref={player} className="how-video">
            {/* Recorded from the tour itself, with the same words: its voice is AI-generated, and its captions say every line. */}
            <video controls preload="none" poster={video.poster} aria-label="Sightline tutorial video">
              <source src={video.file} type="video/mp4" />
              <track kind="captions" src={video.captions} srcLang="en" label="English" default />
            </video>
            <p className="how-caption">The same tour as a video. Its voice is AI-generated; the captions say every line.</p>
          </div>
        )}
      </section>

      <div className="how-intro">
        <p className="how-kicker">How it works</p>
        <h1>From NASA’s measurements to “can we land here?”</h1>
        <p>
          Every number on this site is computed from public NASA data by our own code. Nothing is typed in by hand,
          and nothing is made up by an AI.
        </p>
        <p>
          Two things are made by AI, and carry an “AI” tag where they appear: Scout’s answers, which a language model writes from our numbers (its voice is synthetic too), and
          Scout’s mark, the round badge beside its name. Scout’s answers and its mark are AI-generated.
        </p>
        {/* Which model, from what the co-pilot service reports right now, so this cannot go stale. */}
        <p className="how-scout-model">
          Scout is Anthropic’s Claude{scoutModel ? ` (${scoutModel})` : ''}. He reads the same data as the screen, through the service’s read-only tools, and never works out a number himself:
          the server fills in every number, date and time from that data.
        </p>
      </div>

      <Act number={1} title="From data to an answer" lede="A lander near the Moon’s south pole needs sunlight for power and a line of sight to Earth for radio. Both are decided by the hills around it.">
        <Flow steps={pipeline} label="How the data is processed" />
        <p className="how-caption">The Sun circles the horizon about once every 29.5 Earth days. The terrain decides when a site is lit.</p>
        {range && (
          <p className="how-caption">
            The data covers every hour from 1 January {range.first_year} to 31 December {range.last_year}, in UTC. Times decades ahead use today’s table of leap seconds:
            by then UTC may differ by a few seconds, which does not matter at hourly steps.
          </p>
        )}
        <p className="how-caption">
          Two angles say where the Sun or Earth is. Its elevation is measured from a level horizon. Its height above the skyline is measured from the terrain’s outline in its
          direction, as seen from the site, and that is what decides whether it is in view: on high ground the skyline sits below level, so a body can be below level and still in
          view.
        </p>
        <p className="how-caption how-heights">
          Every number is for a point 2 m above the ground, a small lander’s deck. Sightline’s Planner can read the Sun at a solar panel’s height instead (5 m or 10 m, the
          middle and top of NASA’s vertical solar array) and Earth at an antenna’s (4 m, the top of a Nova-C class lander, or 10 m), from the same model run again for those
          heights at the listed sites. From higher up the terrain sits lower in the sky, so the Sun and Earth are never in view less. A few metres do not move them in the sky
          by more than the 0.01° our tracks are rounded to, so the comparison with JPL Horizons holds at every height.
        </p>
        <p className="how-caption">
          Where a page shows power in watts per square metre, it is the sunlight reaching a panel before any panel losses: the Sun’s full strength (1361 W/m²) times the share of
          its disc in view and how squarely the light meets the panel. Near the pole the Sun stays low, so an upright panel that turns to face it gets nearly all of that, and a
          panel lying flat gets almost none. Sightline’s “Sunlight at landing” is that figure for a surface facing the Sun: the sunlight available, not the power a lander
          would make from it.
        </p>
        <p className="how-caption">
          Where landings are compared, a star marks the best value in each row. There is no single blended score: the weights behind one would be invented.
        </p>
      </Act>

      <Act number={2} title="Data sources" lede="Everything the site is built on, who provides it, and what it does here.">
        <DataSources />
      </Act>

      <Act number={3} title="How we know it’s right" lede="We check our positions against NASA’s JPL Horizons service, and our long-run averages against NASA’s own illumination maps. Where they disagree, we say so.">
        {data ? (
          <>
            <p className="how-caption">
              For {data.site.name}, {monthLabel(data.month)}:
            </p>
            <TrustNotes data={data} />
          </>
        ) : (
          <p className="how-caption">Loading the checks for this site…</p>
        )}
      </Act>

      <Act number={4} title="The whole pole, not only the listed sites" lede={`A planner wants to ask about any ground, not only the ${siteCount} listed sites. So the Atlas runs the same calculation at every pixel, and the light you see on its map is the answer itself.`}>
        <Flow steps={everyPixel} label="How the map of the polar ground is made" />
        {light ? (
          <p className="how-caption">
            Checked two ways, each against a deliberately wrong sky. At {light.sites} listed sites the map’s code gives{' '}
            {light.worstAgreePct === 100 ? 'the site’s own answer in every one' : `the site’s own answer in at least ${light.worstAgreePct}%`} of {light.hours.toLocaleString('en-US')} hours. Across{' '}
            {light.pixels.toLocaleString('en-US')} pixels its long-run Sun is within {light.meanAbs.toFixed(1)} points of NASA’s own map on average (correlation{' '}
            {light.r.toFixed(2)}); turn the sky half way round and that falls to {light.rTurned.toFixed(2)}, take the terrain away and it falls to{' '}
            {light.rNoTerrain.toFixed(2)}. On the brightest ground this check says little, and a pixel is one point: a neighbour {light.pixelM} m away can differ, so the page
            gives a range.
          </p>
        ) : (
          <p className="how-caption">Loading the checks for the map…</p>
        )}
        <p className="how-caption">
          <a href="/atlas/">Open the Atlas</a> to tap any ground, or <a href="/briefing/">play the two-minute briefing</a>.
        </p>
      </Act>

      <Act number={5} title="What it runs on" lede="The whole site is described in code, so it can be rebuilt from nothing in minutes. There are no passwords or keys anywhere in it.">
        <h3>When you open the site</h3>
        <Flow steps={VISIT} label="What happens when you open the site" />
        <h3>When we change it</h3>
        <Flow steps={SHIP} label="How a change reaches the site" />
        <h3>When the data is rebuilt</h3>
        <Flow steps={REBUILD} label="How the data is rebuilt" />
        <p className="how-caption">
          Every box above is declared in Terraform. An uptime check emails us if the site stops answering, an
          objective (99.5% of requests succeed) alerts us when failures pile up, every request is traced so we can
          see where a slow one spent its time, and a budget alert watches the spending.
        </p>
        <h3>When someone asks the co-pilot a question</h3>
        <Flow steps={COUNT} label="How a question is counted" />
        <h3>Co-pilot questions today</h3>
        <QuestionCounts counts={counts} />
        <h3>The services, right now</h3>
        <p className="how-caption">
          The site is several services behind one address. The load balancer sends each path to its own, so when one fails the
          others keep going. The web server asks the others how they are, proving who it is with a short-lived token from Google,
          and gives each one second to answer.
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
      </Act>

      <Act number={6} title="How the co-pilot stays honest" lede="A language model is good with words and unreliable with numbers. So ours is never allowed to write one.">
        <Flow steps={copilot} label="How the co-pilot answers" />
        <p className="how-caption">
          The same rule covers its buttons: the server rebuilds each one from parts it has checked, so the model can
          only send you to a real site, month and hour.
        </p>
      </Act>

      <footer className="how-foot">
        <p>Sightline is a hackathon project. Do not use it for real mission decisions.</p>
        <p>
          Built by team Shackleton Station for the NASA Space Apps Challenge 2026. Not affiliated
          with or endorsed by NASA. Results are a first pass for learning and comparison, not mission planning advice.
        </p>
        <button type="button" onClick={onBack}>
          ← {backLabel}
        </button>
      </footer>
    </main>
  )
}
