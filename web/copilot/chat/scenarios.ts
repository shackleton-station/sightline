import type { SiteInfo } from '../../src/data/contract'
import { formatDuration } from '../../src/lib/nextChange'
import { heightsWords, isBaseHeights } from '../../src/lib/heights'
import { locateHour } from '../../src/lib/mission'
import { entryAt } from '../../src/lib/shortlist'
import { COMPARE_ROWS, measureScenario, nearestFittingSite, readScenarioLink, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../../src/lib/sightlineMission'
import type { ViewState } from '../../src/lib/urlState'
import type { SiteData } from '../../shared/tools/data'
import { fact, type Fact, isoAt, whenLabel } from '../../shared/tools/facts'
import { nextLandingOnScreen } from '../../shared/tools/nextLanding'

/** What the co-pilot is told when the visitor is on the Sightline screen, which holds up to four scenarios. */
export interface ScenarioScene {
  /** The view with the scenario on show as its site and hour, so the tools and buttons start from it. */
  view: ViewState
  /** Which scenario is on show, every scenario by its letter, and each one's Compare figures. */
  facts: Fact[]
}

/** What each Compare figure is called in the facts, by the table's row. */
const FIGURES: Record<(typeof COMPARE_ROWS)[number]['key'], { key: string; label: string; unit: string }> = {
  sunPct: { key: 'sunlit_share_of_mission', label: 'share of its mission with the Sun up', unit: '%' },
  sunGapH: { key: 'longest_time_without_sun', label: 'longest time without the Sun during its mission', unit: ' h' },
  earthPct: { key: 'earth_in_view_share_of_mission', label: 'share of its mission with Earth in view', unit: '%' },
  earthGapH: { key: 'longest_time_without_earth', label: 'longest time without Earth during its mission', unit: ' h' },
  slopeDeg: { key: 'ground_slope', label: 'ground slope', unit: '°' },
}

/**
 * Reads a Sightline link: one that says which scenario is on show (`sc=`), as the screen always
 * sends it, or one that carries the heights of the solar panel or the antenna (`hp=`, `ha=`), which
 * only that screen writes. A shared or older link may have the heights without the mark; they are
 * used all the same, with the first scenario on show. The scenarios keep the letters the page gives them. Each listed site's figures are worked out by the same function as the
 * page's Compare table (`measureScenario`), so the co-pilot and the table cannot disagree. Null for
 * any other page's link.
 */
export async function scenarioScene(hash: unknown, base: ViewState, data: SiteData): Promise<ScenarioScene | null> {
  if (typeof hash !== 'string' || hash.length > 1500) return null
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  // The opening screen's link (`watch=1`) holds no scenario, whatever else it carries.
  if (params.has('watch') || (!params.has('sc') && !params.has('hp') && !params.has('ha'))) return null
  const sites = await data.sites()
  const span = await data.flags(sites[0].id)
  const link = readScenarioLink(hash, span.start, span.sun.length)
  if (!link) return null
  const { scenarios, active, mission } = link
  const nameOf = (scenario: SightlineScenario) => sites.find((site) => site.id === scenario.site)?.name ?? 'a custom point'
  const words = (scenario: SightlineScenario) => `${nameOf(scenario)}, landing ${whenLabel(isoAt(span.start, scenario.landing))}`

  const facts: Fact[] = [
    fact('scenario_on_screen', 'The scenario on screen (answer about this one unless asked about another)', `${SCENARIO_LETTERS[active]}: ${words(scenarios[active])}`),
    fact('scenario_count', 'How many scenarios the visitor has', String(scenarios.length)),
  ]
  // The heights the visitor chose for the solar panel and the antenna, when not the app's own 2 m.
  // The scenario figures below are then worked out at those heights, as the visitor's screen does;
  // if those sets cannot be read here they are for 2 m, and the fact says so. The tools stay at 2 m.
  if (!isBaseHeights(mission.heights)) {
    const reads = await Promise.all(scenarios.map((scenario) => (sites.some((site) => site.id === scenario.site) ? data.flagsAt(scenario.site, mission.heights).catch(() => null) : null)))
    const atHeights = reads.some((flags) => flags !== null)
    facts.push(
      fact(
        'heights_above_ground',
        'Heights above the ground the visitor chose (the Sun is read at the solar panel\'s height, Earth at the antenna\'s)',
        `${heightsWords(mission.heights)}. ${atHeights ? 'The scenario figures here are for these heights, as on the visitor\'s screen.' : 'The scenario figures here are for 2 m, so the visitor\'s screen can show a little more Sun or Earth.'} Every tool's numbers are for 2 m above the ground; from higher up the Sun and Earth are never in view less. A custom point is always worked out at 2 m.`,
      ),
      // Each height as a fact of its own, so it can be cited: a height typed by hand is a number of the model's own.
      fact('panel_height', 'How high above the ground the solar panel stands (the Sun is read from here)', `${mission.heights.panelM} m`),
      fact('antenna_height', 'How high above the ground the antenna stands (Earth is read from here)', `${mission.heights.antennaM} m`),
    )
  }
  for (const [i, scenario] of scenarios.entries()) {
    const letter = SCENARIO_LETTERS[i]
    const key = `scenario_${letter.toLowerCase()}`
    facts.push(fact(key, `Scenario ${letter}`, words(scenario)))
    const site = sites.find((candidate) => candidate.id === scenario.site)
    if (site) facts.push(...(await figures(key, letter, scenario, site, mission, data)))
    // For the scenario on show, when it does not fit: the other site the visitor's screen offers for the same date.
    if (site && i === active) facts.push(...(await elsewhere(key, letter, scenario, site, sites, mission, data)))
    // Only a custom point has no figures here. (A listed site that is not on show has its figures above, and nothing more to say.)
    if (!site) facts.push(fact(`${key}_figures`, `Scenario ${letter}: its figures`, 'not available here (a custom point, not a listed site)'))
  }

  const onShow = scenarios[active]
  const { month, index } = locateHour(span.start, onShow.landing)
  const others = scenarios.filter((_, i) => i !== active).map((scenario) => ({ site: scenario.site, at: entryAt(isoAt(span.start, scenario.landing)) }))
  return { view: { ...base, a: { site: onShow.site, month }, index, shortlist: others }, facts }
}

/**
 * When a scenario does not meet the mission limits: the nearest listed site of the same group where
 * the same landing does, found by the function the visitor's screen uses for its "Fits at … on this
 * date" line, or the plain statement that there is none. Nothing when the scenario fits.
 */
async function elsewhere(key: string, letter: string, scenario: SightlineScenario, site: SiteInfo, sites: SiteInfo[], mission: SightlineMission, data: SiteData): Promise<Fact[]> {
  const atHeights = async (id: string) => (isBaseHeights(mission.heights) ? null : await data.flagsAt(id, mission.heights).catch(() => null))
  const flagsOf = async (id: string) => (await atHeights(id)) ?? (await data.flags(id))
  const group = sites.filter((other) => other.group === site.group)
  const listed = await Promise.all(group.map(async (other) => ({ site: other, flags: await flagsOf(other.id) })))
  const own = listed.find((entry) => entry.site.id === site.id)
  if (!own || measureScenario(scenario, site, own.flags, mission, site.slope?.deg ?? null).problems.length === 0) return []
  // The next landing that fits, as the screen's column offers it: judged on the same hours as the
  // figures (the visitor's heights where their files can be read), with the Sun's disc seen from the panel.
  const high = (await atHeights(site.id)) !== null
  const next = await nextLandingOnScreen(data, site.id, own.flags, isoAt(own.flags.start, scenario.landing), mission.requirements, high ? mission.heights.panelM : undefined)
  const nextFacts = next
    ? [
        fact(`${key}_next_landing`, `Scenario ${letter}: the next landing at its site that meets the mission limits, as the visitor's screen offers it`, whenLabel(next.t)),
        fact(`${key}_next_landing_wait`, `Scenario ${letter}: the wait until that landing`, formatDuration(next.waitH)),
      ]
    : [fact(`${key}_next_landing`, `Scenario ${letter}: the next landing at its site that meets the mission limits`, 'none in the data')]
  const found = nearestFittingSite(site, scenario.landing, mission, listed)
  // Two facts, one or the other, each made to sit inside a sentence: the place where the same date
  // fits ("it fits at {{…}}"), or a clause saying that none of the group's other sites does.
  const other = found
    ? fact(`${key}_fits_at_another_site`, `Scenario ${letter}: the nearest site of the same group (${site.group}) where the same landing date meets the mission limits`, `${found.site.name}, ${found.km < 10 ? found.km.toFixed(1) : Math.round(found.km)} km away`)
    : fact(`${key}_no_other_site_fits`, `Scenario ${letter}: the other sites of the same group (${site.group}) on the same landing date, as a clause that stands in a sentence`, 'none of the other sites in its group fits on this date')
  return [...nextFacts, other]
}

/** One scenario's Compare figures, written as the table writes them. */
async function figures(key: string, letter: string, scenario: SightlineScenario, site: SiteInfo, mission: SightlineMission, data: SiteData): Promise<Fact[]> {
  const flags = (isBaseHeights(mission.heights) ? null : await data.flagsAt(site.id, mission.heights).catch(() => null)) ?? (await data.flags(site.id))
  const measure = measureScenario(scenario, site, flags, mission, site.slope?.deg ?? null)
  const rows = COMPARE_ROWS.flatMap((row) => {
    const value = measure[row.key]
    const figure = FIGURES[row.key]
    return value === null ? [] : [fact(`${key}_${figure.key}`, `Scenario ${letter}: ${figure.label}`, `${value.toFixed(row.digits)}${figure.unit}`)]
  })
  // The verdict in a few words, and each reason as a fact of its own that drops into a sentence
  // ("because {{r0.scenario_a_reason_1}}"): no capital to start, no full stop to end.
  const verdict = fact(`${key}_verdict`, `Scenario ${letter}: against the mission limits`, measure.problems.length === 0 ? 'meets the mission limits' : 'does not meet the mission limits')
  const reasons = measure.problems.map((problem, i) => fact(`${key}_reason_${i + 1}`, `Scenario ${letter}: why it does not meet the mission limits`, problem.replace(/\.$/, '').replace(/^The /, 'the ')))
  return [...rows, verdict, ...reasons]
}
