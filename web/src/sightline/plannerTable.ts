import type { ShadowAnswer, ShadowDistances } from '../data/contract'
import type { SiteFlags } from '../lib/flags'
import { missionEarth } from '../lib/mission'
import type { RiverState } from '../lib/river'
import { degWords, isoAt, stateAt } from '../lib/sightline'
import { bestIn, COMPARE_ROWS, type ScenarioMeasure, SCENARIO_LETTERS, shareHours, type SightlineMission, type SightlineScenario } from '../lib/sightlineMission'
import { shortReason } from '../lib/sightlineSky'
import { landingVerdict, marginalAtLanding, type VerdictState } from '../lib/landingVerdict'
import { bestByPair, type ShareQuantity, type ShareTies } from '../lib/starTie'
import { STATE_CHIP } from './states'
import type { LandingShares } from './useScenarioFacts'

/** One row of the Full planner's table: a name, a cell per scenario, and which cells are the best. */
export interface PlannerRow {
  key: string
  label: string
  /** What the row measures, for its name's hover text, where the name alone does not say. */
  title?: string
  /** What each scenario's cell says; null while its site is still being worked out. */
  cells: (string | null)[]
  /** The hours behind each cell that is a share of the mission ("12 of 24 h"); null for any other cell. */
  notes: (string | null)[]
  best: boolean[]
  /** For "In view": each scenario's state at landing, drawn as a key beside its words. */
  states?: (RiverState | null)[]
  /** For the verdict: whether each scenario fits; null while it is being worked out. */
  fits?: (boolean | null)[]
  /** For the verdict: each scenario's state, as the plan column gives it (a plain fit, a marginal one, a miss); null while it is being worked out. */
  verdicts?: (VerdictState | null)[]
  /** True when a star in this row was shared or withheld because two sites are closer than the model's measured error. */
  tooClose?: boolean
}

/** Rows that belong together, under one name: the verdict, then what it rests on. */
export interface PlannerGroup {
  key: string
  name: string
  rows: PlannerRow[]
}

/**
 * Share of the mission with the Sun up and Earth in view at the same hour, in percent, counted the
 * way Compare counts Earth alone. Null when the mission runs past the end of the data.
 */
export function bothPct(flags: SiteFlags, landing: number, mission: SightlineMission): number | null {
  const end = landing + mission.requirements.missionDays * 24
  if (end > flags.sun.length || end <= landing) return null
  const earth = missionEarth(flags, mission.requirements)
  let up = 0
  for (let hour = landing; hour < end; hour += 1) if (flags.sun[hour] && earth[hour]) up += 1
  return (100 * up) / (end - landing)
}

/**
 * The table's rows with a number in them: Compare's five, the share of the mission with both the
 * Sun and Earth, and, where the caller has it, the average sunlight on a panel (each scenario's is
 * undefined while its months load, null if it cannot be worked out). `compareGroups` puts them
 * under their headings, with the verdict, the landing hour and the science rows.
 */
export function plannerRows(scenarios: SightlineScenario[], measures: (ScenarioMeasure | null)[], flags: (SiteFlags | null)[], mission: SightlineMission, sunlightWm2?: (number | null | undefined)[], ties?: ShareTies): PlannerRow[] {
  // The three shares of the mission: between two different sites a lead inside the model's measured error earns no star (lib/starTie.ts).
  const starFor = (quantity: ShareQuantity, values: (number | null)[], tie: number) => (ties ? bestByPair(values, 'high', (i, j) => ties(quantity, i, j)) : { best: bestIn(values, 'high', tie), tooClose: false })
  const write = (value: number | null, known: boolean, digits: number) => (value === null ? (known ? '?' : null) : value.toFixed(digits))
  const hours = (value: number | null) => (value === null ? null : shareHours(value, mission.requirements.missionDays))
  const rows: PlannerRow[] = COMPARE_ROWS.map((row) => {
    const values = measures.map((measure) => measure?.[row.key] ?? null)
    const star = row.key === 'sunPct' ? starFor('sun', values, row.tie) : row.key === 'earthPct' ? starFor('earth', values, row.tie) : { best: bestIn(values, row.better, row.tie), tooClose: false }
    return {
      key: row.key,
      label: row.label,
      cells: values.map((value, i) => write(value, measures[i] !== null, row.digits)),
      notes: values.map((value) => (row.share ? hours(value) : null)),
      best: star.best,
      tooClose: star.tooClose,
    }
  })
  const both = scenarios.map((scenario, i) => {
    const site = flags[i]
    return site ? bothPct(site, scenario.landing, mission) : null
  })
  const bothStar = starFor('both', both, 0.5)
  rows.splice(4, 0, { key: 'bothPct', label: 'Sun and Earth together, %', cells: both.map((value, i) => write(value, flags[i] !== null, 0)), notes: both.map(hours), best: bothStar.best, tooClose: bothStar.tooClose })
  // With two or more scenarios that all read the same (1361 W/m² where the Sun never leaves), the row separates nothing: it is left out.
  const allTheSame = (values: (number | null | undefined)[]) => values.length > 1 && values.every((value) => typeof value === 'number' && Math.round(value) === Math.round(values[0] as number))
  if (sunlightWm2 && !allTheSame(sunlightWm2)) {
    const sunlight = sunlightWm2.map((value) => value ?? null)
    rows.splice(5, 0, {
      key: 'sunlightWm2',
      label: 'Sunlight on a panel, W/m²',
      title: SUNLIGHT_MEANS,
      cells: sunlight.map((value, i) => write(value, sunlightWm2[i] !== undefined, 0)),
      notes: sunlight.map(() => null),
      best: bestIn(sunlight, 'high', SUNLIGHT_TIE_W_M2),
    })
  }
  return rows
}

/** What the sunlight row is, in its name's hover text: the app has no panel of its own, so it gives sunlight, not electrical power. */
const SUNLIGHT_MEANS =
  'Average sunlight over the mission on a panel that turns to face the Sun. Multiply by the panel\'s area and efficiency for electrical power.'
/** Sunlight this close shares the best mark: about the half point the Sun's share of the mission ties at, of the Sun's full 1361 W/m². */
const SUNLIGHT_TIE_W_M2 = 7

/** How the two angles at landing are measured, for their names' hover text. */
const FROM_LEVEL = 'Its height at landing above a flat horizon. From high ground the skyline lies below 0°, so a negative figure can still be in view.'
const ABOVE_SKYLINE = 'How far its center is above the skyline at landing. Below 0° the terrain hides its center.'

/**
 * The Sun's and Earth's angles at each landing: from level, and above the skyline. Units in the
 * row's name, as in the rows above; no best mark, because neither angle is a limit of the mission.
 */
export function landingRows(landings: (LandingShares | null)[]): PlannerRow[] {
  const row = (key: string, label: string, title: string, pick: (landing: LandingShares) => number): PlannerRow => ({
    key,
    label,
    title,
    cells: landings.map((landing) => (landing ? degWords(pick(landing)).replace('°', '') : null)),
    notes: landings.map(() => null),
    best: landings.map(() => false),
  })
  return [
    row('sunElDeg', "Sun's elevation, °", FROM_LEVEL, (landing) => landing.sunElDeg),
    row('sunAboveDeg', 'Sun above the skyline, °', ABOVE_SKYLINE, (landing) => landing.sunAboveDeg),
    row('earthElDeg', "Earth's elevation, °", FROM_LEVEL, (landing) => landing.earthElDeg),
    row('earthAboveDeg', 'Earth above the skyline, °', ABOVE_SKYLINE, (landing) => landing.earthAboveDeg),
  ]
}

/** One field of a CSV line: quoted when it holds a comma, a quote or a line break. */
function field(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The table as CSV: a column per scenario, headed by its letter, site and landing time (UTC), then
 * the rows as the page shows them, whether each fits the mission (with the reasons if not, or if only
 * marginally), and the mission's limits in words. `marginal` holds, for each scenario, why a fit is
 * only marginal (`marginalAtLanding`); without it a fit is written as a plain one.
 */
export function plannerCsv(start: string, scenarios: SightlineScenario[], siteNames: string[], rows: PlannerRow[], measures: (ScenarioMeasure | null)[], missionWords: string, marginal: string[][] = []): string {
  const fits = measures.map((measure, i) => {
    if (!measure) return ''
    const said = landingVerdict(measure.problems, marginal[i] ?? [])
    return said.state === 'miss' ? `no: ${said.reasons.join(' ')}` : said.state === 'marginal' ? `yes, marginal: ${said.reasons.join(', and ')}` : 'yes'
  })
  const lines = [
    ['', ...scenarios.map((scenario, i) => `${SCENARIO_LETTERS[i]} · ${siteNames[i]} · ${isoAt(start, scenario.landing)}`)],
    // The verdict is written out in full below, with the app's whole sentences.
    ...rows.filter((row) => row.key !== 'fits').map((row) => [row.label, ...row.cells.map((cell) => cell ?? '')]),
    ['Fits the mission', ...fits],
    ['Mission', missionWords],
  ]
  return `${lines.map((line) => line.map(field).join(',')).join('\n')}\n`
}

/** The two shadow rows' hover text: what the distance is to, how it is measured, and whose map it is. The fuller wording stays in `shadow.json`. */
const SHADOW_TIP = {
  patch: 'Distance to the nearest ground that sunlight never reaches, however small the patch, straight over the surface. From NASA’s map of permanent shadow (LOLA; Mazarico et al. 2011).',
  region: 'Distance to the nearest shadowed region of 10 km² or more, straight over the surface. From NASA’s map of permanent shadow (LOLA; Mazarico et al. 2011).',
}

/** What a scenario's cell says of the distance to permanent shadow, from `shadow.json`. */
export function shadowWords(answer: ShadowAnswer | null): string | null {
  if (!answer) return null
  if (answer.status === 'found') return `${answer.distance_km < 10 ? answer.distance_km.toFixed(1) : answer.distance_km.toFixed(0)} km`
  if (answer.status === 'none_within') return `none within ${answer.within_km.toLocaleString('en-US')} km`
  return `none mapped within ${answer.map_edge_km.toLocaleString('en-US')} km`
}

/** What Compare's rows are worked out from: the scenarios, and each one's site, flags, measure and landing hour. */
export interface CompareInput {
  scenarios: SightlineScenario[]
  /** Each scenario's listed site id; null for a custom point, which has no entry in `shadow.json`. */
  siteIds: (string | null)[]
  measures: (ScenarioMeasure | null)[]
  flags: (SiteFlags | null)[]
  mission: SightlineMission
  /** The Sun's and Earth's discs and angles at each landing; null while its month loads. */
  landings: (LandingShares | null)[]
  /** The average sunlight on a panel over each mission, in W/m²; undefined while its months load. */
  sunlightWm2?: (number | null | undefined)[]
  /** The distances to permanent shadow; null until the file has loaded. */
  shadow: ShadowDistances | null
  /** How close two scenarios' shares of the mission must be to share the star; without it, half a point for every pair. */
  ties?: ShareTies
}

/**
 * Compare's rows, in groups, the verdict first: whether each scenario fits the mission, in the plan
 * column's three states and marks (with the reasons, in the column's short words), then at landing,
 * power, radio, the ground and science.
 * Every figure is one the app already measures; none is blended into a score.
 */
export function compareGroups({ scenarios, siteIds, measures, flags, mission, landings, sunlightWm2, shadow, ties }: CompareInput): PlannerGroup[] {
  const numbers = plannerRows(scenarios, measures, flags, mission, sunlightWm2, ties)
  const rows = (...keys: string[]) => keys.flatMap((key) => numbers.filter((one) => one.key === key))
  const none = scenarios.map(() => false)
  const blank = scenarios.map(() => null)

  // The verdict on each landing is the plan column's own: the limits it misses, then what makes a fit marginal.
  const said = measures.map((measure, i) => (measure ? landingVerdict(measure.problems, marginalAtLanding(mission.requirements, landings[i])) : null))
  const verdict: PlannerRow = {
    key: 'fits',
    label: 'Fits the mission',
    cells: said.map((one) => (!one ? null : one.state === 'fits' ? `${one.mark} Yes` : one.state === 'marginal' ? `${one.mark} Yes, marginal: ${one.reasons.join('; ')}` : `${one.mark} No: ${one.reasons.map(shortReason).join('; ')}`)),
    notes: blank,
    best: none,
    fits: said.map((one) => (one ? one.state !== 'miss' : null)),
    verdicts: said.map((one) => (one ? one.state : null)),
  }

  const states = scenarios.map((scenario, i) => {
    const site = flags[i]
    return site ? stateAt(site, scenario.landing) : null
  })
  const inView: PlannerRow = { key: 'state', label: 'In view', cells: states.map((state) => (state ? STATE_CHIP[state] : null)), notes: blank, best: none, states }

  const sunAtLanding = landings.map((landing) => (landing ? 100 * landing.sun : null))
  const sunDisc: PlannerRow = {
    key: 'sunAtLanding',
    label: 'Sun in view at landing, %',
    title: "The share of the Sun's disc above the skyline at landing. 100 means the whole Sun is in view.",
    cells: sunAtLanding.map((value) => (value === null ? null : value.toFixed(0))),
    notes: blank,
    best: bestIn(sunAtLanding, 'high', 0.5),
  }

  const shadowRow = (kind: 'patch' | 'region', label: string): PlannerRow => {
    const found = siteIds.map((id) => (shadow && id ? (shadow.sites[id]?.[kind] ?? null) : null))
    const km = found.map((answer) => (answer?.status === 'found' ? answer.distance_km : null))
    return {
      key: `shadow-${kind}`,
      label,
      title: shadow ? SHADOW_TIP[kind] : undefined,
      // A custom point is in no file of distances: its cell says so once the file is here.
      cells: found.map((answer, i) => (!shadow ? null : siteIds[i] === null ? 'not worked out for a custom point' : shadowWords(answer))),
      notes: blank,
      // Two distances that print the same share the mark.
      best: bestIn(km, 'low', 0.05),
    }
  }

  return [
    { key: 'verdict', name: 'Verdict', rows: [verdict] },
    { key: 'landing', name: 'At landing', rows: [inView, ...landingRows(landings)] },
    { key: 'power', name: 'Power', rows: [...rows('sunPct', 'sunGapH', 'sunlightWm2'), sunDisc] },
    { key: 'radio', name: 'Radio', rows: rows('earthPct', 'earthGapH', 'bothPct') },
    { key: 'ground', name: 'Ground', rows: rows('slopeDeg') },
    {
      key: 'science',
      name: 'Science',
      rows: [shadowRow('patch', 'Permanent shadow, nearest'), shadowRow('region', `Shadow of ${shadow?.region_min_km2 ?? 10} km² or more, nearest`)],
    },
  ]
}
