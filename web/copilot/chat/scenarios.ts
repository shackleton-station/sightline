import type { SiteInfo } from '../../src/data/contract'
import { heightsWords, isBaseHeights } from '../../src/lib/heights'
import { locateHour } from '../../src/lib/mission'
import { entryAt } from '../../src/lib/shortlist'
import { COMPARE_ROWS, measureScenario, readScenarioLink, SCENARIO_LETTERS, type SightlineMission, type SightlineScenario } from '../../src/lib/sightlineMission'
import type { ViewState } from '../../src/lib/urlState'
import type { SiteData } from '../../shared/tools/data'
import { fact, type Fact, isoAt, whenLabel } from '../../shared/tools/facts'

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
 * Reads a Sightline link (one that says which scenario is on show, `sc=`). The scenarios keep the
 * letters the page gives them. Each listed site's figures are worked out by the same function as the
 * page's Compare table (`measureScenario`), so the co-pilot and the table cannot disagree. Null for
 * any other page's link.
 */
export async function scenarioScene(hash: unknown, base: ViewState, data: SiteData): Promise<ScenarioScene | null> {
  if (typeof hash !== 'string' || hash.length > 1500 || !new URLSearchParams(hash.replace(/^#/, '')).has('sc')) return null
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
    )
  }
  for (const [i, scenario] of scenarios.entries()) {
    const letter = SCENARIO_LETTERS[i]
    const key = `scenario_${letter.toLowerCase()}`
    facts.push(fact(key, `Scenario ${letter}`, words(scenario)))
    const site = sites.find((candidate) => candidate.id === scenario.site)
    if (site) facts.push(...(await figures(key, letter, scenario, site, mission, data)))
    else facts.push(fact(`${key}_figures`, `Scenario ${letter}: its figures`, 'not available here (a custom point, not a listed site)'))
  }

  const onShow = scenarios[active]
  const { month, index } = locateHour(span.start, onShow.landing)
  const others = scenarios.filter((_, i) => i !== active).map((scenario) => ({ site: scenario.site, at: entryAt(isoAt(span.start, scenario.landing)) }))
  return { view: { ...base, a: { site: onShow.site, month }, index, shortlist: others }, facts }
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
  const fits = measure.problems.length === 0 ? 'meets the mission limits' : `does not meet the mission limits: ${measure.problems.join(' ')}`
  return [...rows, fact(`${key}_verdict`, `Scenario ${letter}: against the mission limits`, fits)]
}
