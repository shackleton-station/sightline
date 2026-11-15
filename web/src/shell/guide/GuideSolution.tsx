import type { ReactNode } from 'react'
import type { LightChecks } from '../../data/lightChecks'
import type { ScenarioData } from '../../data/scenarioData'
import type { VerdictState } from '../../lib/landingVerdict'
import type { FeatureGuide, TourStep } from '../../lib/tour'
import { GuideNumbers } from './GuideNumbers'
import { Flow, type FlowStep, GuideStep } from './GuideParts'
import { advancedMeanings, ANGLES_TO_CENTER, IN_VIEW, limitMeanings, MARGINAL_MEANS, MEANING_LABELS, meaningLine, SUN_SHARE_KEPT } from '../../lib/limitMeanings'
import { SUN_CIRCLES } from '../../lib/moonExplained'

/** The verdict on the scenario on show, as the plan gives it. */
export interface VerdictOnShow {
  state: VerdictState
  mark: string
  words: string
}

interface Props {
  data: ScenarioData | null
  siteCount: number
  /** The years the data covers, in words. */
  span: string
  range: { hours: number; first_year: number; last_year: number } | null
  light: LightChecks | null
  verdict: VerdictOnShow | null
  /** The tour's steps, written out: each one's title and the line on its card. */
  steps: TourStep[]
  guides: FeatureGuide[]
  onGuide?: (id: string) => void
}

interface Tool {
  name: string
  question: string
  does: string
  /** What its answer looks like: the screen's own words, with this scenario's figure where the page has one. */
  sample: ReactNode
}

/**
 * Step 3: how an answer is made, then the tools, each as the planning question it answers. The
 * feature guides and the tour's written steps follow, and the definitions behind the numbers.
 */
export function GuideSolution({ data, siteCount, span, range, light, verdict, steps, guides, onGuide }: Props) {
  const directions = data ? String(data.horizon.length) : 'hundreds of'
  const height = data ? `${data.summary.obs_height_m} m` : 'a lander’s height'

  const pipeline: FlowStep[] = [
    { name: 'NASA data', does: 'The shape of the Moon, and where the Sun and Earth are.', tech: 'LOLA laser altimeter terrain · NAIF SPICE kernels' },
    { name: 'The skyline', does: `How high the land stands in ${directions} directions around the site.`, tech: 'ray march to 200 km over the terrain, on a sphere' },
    { name: 'Every hour', does: `Is the Sun or Earth above that skyline, ${height} off the ground?`, tech: 'SPICE positions in the MOON_ME frame, with light time' },
    { name: 'The answer', does: `Hourly visibility for ${siteCount} sites, ${span}.`, tech: 'static JSON and terrain tiles · all times in UTC' },
  ]

  // The map of the polar ground's light: the same calculation, at every pixel. Its numbers are read
  // from the pipeline's own files, like every other number here.
  const everyPixel: FlowStep[] = [
    { name: 'The same calculation', does: 'The skyline and the hourly check a listed site gets.', tech: `the same ${directions} directions, out to the same 200 km, ${height} above the ground` },
    { name: 'At every pixel', does: light ? `Each ${light.pixelM} m of a ${light.widthKm} km square on the south pole${light.wide ? `, and each ${light.wide.pixelM} m of a ${light.wide.widthKm} km one around it` : ''}.` : 'Every pixel of a square on the south pole.', tech: `${light ? `${light.millionsOfPixels.toFixed(1)} million` : 'millions of'} pixels · Python compiled with Numba` },
    { name: 'Kept as changes', does: 'A pixel’s month is the hours its Sun and Earth come and go.', tech: 'one file of a few megabytes a month · Cloud Storage' },
    { name: 'Drawn by your graphics card', does: 'Moving time changes one number; nothing is sent again.', tech: 'integer textures · a WebGL2 shader in Three.js' },
  ]

  const tools: Tool[] = [
    {
      name: 'Sightline',
      question: 'Can we land here, now?',
      does: 'Pick a site, a landing hour and a mission. The plan gives one verdict, with the hours of sunlight, the hours with Earth in view and the longest time without each.',
      sample: verdict ? (
        <>
          <span data-verdict={verdict.state}>
            {verdict.mark} {verdict.words}
          </span>
          <small>the scenario on show</small>
        </>
      ) : (
        '✓ Fits · ◇ Fits, marginal · ✗ Does not fit'
      ),
    },
    {
      name: 'Planner',
      question: 'What if the date slips?',
      does: 'Find shows a year month by month: the days with a landing that fits at every listed site. Months differ, because the Moon has seasons. When a landing does not fit, the plan names the next one that does. Set your own limits, or read the Sun from a solar panel’s height and Earth from an antenna’s.',
      sample: 'Next landing that fits →',
    },
    {
      name: 'Landing accuracy',
      question: 'What if we miss the spot?',
      does: 'Say how close the lander can get to its aim point. See the share of touchdowns that still fit, why the rest do not, and a better place to aim.',
      sample: 'The share that fit, and a better aim',
    },
    {
      name: 'Compare',
      question: 'Which option is better?',
      does: 'Keep up to four scenarios side by side. A star marks the best value in each row. There is no blended score: the weights behind one would be invented.',
      sample: '★ best in its row',
    },
    {
      name: 'Orbit · Site · Surface',
      question: 'What will the lander see?',
      does: 'Three views of the same hour: the whole Moon as it is lit, the ground close in, and the skyline from the landing point with the Sun and Earth in place.',
      sample: 'One hour, three views',
    },
    {
      name: 'Layers',
      question: 'What is the ground like?',
      does: 'Lay NASA’s maps from Moon Trek over the ground: photo, steep ground, permanent shadow, long-run sunlight, temperature. “Light and shadow” is our own hour-by-hour map.',
      sample: data?.slope ? (
        <>
          Slope {data.slope.deg.toFixed(1)}°<small>{data.site.name}</small>
        </>
      ) : (
        'NASA’s maps over the ground'
      ),
    },
    {
      name: 'Custom point',
      question: 'What about somewhere new?',
      does: `Plan a landing anywhere on the Moon. Around the south pole the same calculation is run at every pixel of the ground, so “Light and shadow”, in Layers, can show ground that no listed site stands on.`,
      sample: light ? (
        <>
          {light.millionsOfPixels.toFixed(1)} million pixels<small>one every {light.pixelM} m{light.wide ? ` or ${light.wide.pixelM} m` : ''}</small>
        </>
      ) : (
        'Any point on the Moon'
      ),
    },
  ]

  return (
    <GuideStep id="how-solution" kicker="Step 3" title="Design a solution" intro="Pick a place, an hour and a mission. Sightline says whether the landing fits, why, and what to change if it does not.">
      <h3>How an answer is made</h3>
      <Flow steps={pipeline} label="How the data is processed" />
      <p className="how-caption">{SUN_CIRCLES}</p>
      {/* The definition the verdict rests on, where a reader sees it without opening a fold. */}
      <p className="how-caption how-in-view">{IN_VIEW}</p>
      <GuideNumbers range={range} siteCount={siteCount} />

      <h3>Seven questions, seven tools</h3>
      <ul className="how-tools">
        {tools.map((tool) => (
          <li key={tool.name} className="how-tool">
            <p className="how-tool-q">
              <i>{tool.name}</i>
              <b>{tool.question}</b>
            </p>
            <p>{tool.does}</p>
            <p className="how-tool-out">{tool.sample}</p>
          </li>
        ))}
      </ul>
      <p className="how-note">Also on the screen: share a plan by link, save it with a name, or read its one-page brief.</p>

      {/* One feature at a time: short tours on the real screen, run by the tour's own engine. */}
      {onGuide && guides.length > 0 && (
        <section className="how-guides" aria-labelledby="how-guides-title">
          <h3 id="how-guides-title">Feature guides</h3>
          <p className="how-start-note">Each is a few steps on the real screen, like the tour.</p>
          <ul className="how-guide-list">
            {guides.map((guide) => (
              <li key={guide.id}>
                <button type="button" data-guide={guide.id} onClick={() => onGuide(guide.id)}>
                  {guide.name}
                </button>{' '}
                <span>
                  {guide.about} {guide.steps.length} steps.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The written version: the same steps Scout's tour walks through, from the same file. */}
      <section className="how-use" aria-labelledby="how-use-title">
        <h3 id="how-use-title">How to use Sightline</h3>
        <ol className="how-use-steps">
          {steps.map((step, i) => (
            <li key={step.id}>
              {/* The story's chapter, once, on the first step of each. */}
              {step.chapter && step.chapter !== steps[i - 1]?.chapter && <i className="how-use-chapter">{step.chapter}</i>}{' '}
              <b>{step.title.replace(/[.?]$/, '')}{/[?]$/.test(step.title) ? '?' : '.'}</b> {step.line ?? step.say}
            </li>
          ))}
        </ol>
      </section>

      <details className="how-more">
        <summary>The whole pole, not only the listed sites</summary>
        <p>
          A planner wants to ask about any ground, not only the {siteCount} listed sites. So the same calculation is run at every pixel of the polar ground: it is what “Light and
          shadow” draws, in Layers.
        </p>
        <Flow steps={everyPixel} label="How the map of the polar ground is made" />
      </details>

      <details className="how-more">
        <summary>How the numbers are defined</summary>
        {range && (
          <p>
            The data covers every hour from 1 January {range.first_year} to 31 December {range.last_year}, in UTC. Times decades ahead use today’s table of leap seconds: by then
            UTC may differ by a few seconds, which does not matter at hourly steps.
          </p>
        )}
        <p>
          Two angles say where the Sun or Earth is. Its elevation is measured from a level horizon. Its height above the skyline is measured from the terrain’s outline in its
          direction, as seen from the site, and that is what decides whether it is in view: on high ground the skyline sits below level, so a body can be below level and still in
          view. {ANGLES_TO_CENTER}
        </p>
        <p className="how-in-view-more">
          <b>What counts as in view.</b> {IN_VIEW} {SUN_SHARE_KEPT} {MARGINAL_MEANS}
        </p>
        <p className="how-heights">
          Every number is for a point 2 m above the ground, a small lander’s deck. Sightline’s Planner can read the Sun at a solar panel’s height instead (5 m or 10 m, the middle
          and top of NASA’s vertical solar array) and Earth at an antenna’s (4 m, the top of a Nova-C class lander, or 10 m), from the same model run again for those heights at the
          listed sites. From higher up the terrain sits lower in the sky, so the Sun and Earth are never in view less. A few meters do not move them in the sky by more than the
          0.01° our tracks are rounded to, so the comparison with JPL Horizons holds at every height.
        </p>
        <p>
          Where a page shows power in watts per square meter, it is the sunlight reaching a panel before any panel losses: the Sun’s full strength (1361 W/m²) times the share of
          its disc in view and how squarely the light meets the panel. Near the pole the Sun stays low, so an upright panel that turns to face it gets nearly all of that, and a
          panel lying flat gets almost none. Sightline’s “Sunlight at landing” is that figure for a surface facing the Sun: the sunlight available, not the power a lander would
          make from it.
        </p>
        <p>
          Where landings are compared, a star marks the best value in each row. Between two different sites, a share of the mission (sunlit, Earth in view, or the two together)
          earns the star only when it leads by more than the model&apos;s measured error against NASA&apos;s maps for that pair of sites: inside it, the sites share the star or
          none is shown. There is no single blended score: the weights behind one would be invented.
        </p>
        <p>
          <b>{MEANING_LABELS.limits}.</b> The mission is a set of limits, and a landing fits when it keeps every one. The first six are on the screen as soon as the mission is
          opened; the last three are behind “Advanced”.
        </p>
        <dl className="how-limit-means">
          {[...limitMeanings(data?.slope ? { overM: data.slope.baseline_m, siteName: data.site.name } : null), ...advancedMeanings()].map((meaning) => (
            <div key={meaning.id} data-limit={meaning.id}>
              <dt>{meaning.name}</dt>
              <dd>{meaningLine(meaning)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </GuideStep>
  )
}
