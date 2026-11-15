import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import type { OverviewYear } from '../../src/data/contract'
import { horizonAt } from '../../src/lib/customModel'
import { hourOf, locateHour, NO_GAP_LIMIT_H } from '../../src/lib/mission'
import { firstSentence, ringedSites, sitesNamedIn } from '../../src/lib/scoutRing'
import { stateAt } from '../../src/lib/sightline'
import { betterDate, type SightlineMission, steadierLanding } from '../../src/lib/sightlineMission'
import type { Bucket } from '../../shared/bucket'
import { siteData } from '../../shared/tools/data'
import { distanceWords, isoAt, limitFacts, reasonClause, whenLabel } from '../../shared/tools/facts'
import { whyWords } from '../../shared/tools/landingTools'
import { runTool } from '../../shared/tools/tools'
import { EARTH_STAYS_PUT, LIBRATION, SEASONS, SUN_AND_EARTH_SKIM, SUN_CIRCLES, TILT_AND_TURN } from '../../src/lib/moonExplained'
import { degWords } from '../../src/lib/sightline'
import type { Model } from '../model'
import { claudeMessage, toolUse } from '../standIns'
import { asksToChangeLimits, buildActions, viewFrom } from './actions'
import { runChat, viewFacts } from './chat'
import { asksAboutPresent, dateBasis, realHourIso } from './dates'
import { systemPrompt } from './prompt'
import { nameForms, renderAnswer, visitorsAmounts } from './render'
import { fitWords, scenarioScene } from './scenarios'

// Nine things found by asking Scout 28 questions on the live site and setting each answer beside
// the screen (notes: scout-answers.md). Everything here runs against the pipeline's real output.
const dataDir = fileURLToPath(new URL('../../public/data', import.meta.url))
const data = siteData(dataDir)
/** The screen's own mission: 14 days, 24 h of darkness, no limit on radio silence. */
const SCREEN = { missionDays: 14, maxSunGapH: 24, maxEarthGapH: NO_GAP_LIMIT_H, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }
const context = { data, requirements: SCREEN }
const MISSION = { requirements: SCREEN, maxSlopeDeg: 10, heights: { panelM: 2, antennaM: 2 } } as SightlineMission

async function facts(tool: string, args: Record<string, unknown>) {
  const result = await runTool(tool, args, context)
  if (!result.ok) throw new Error(result.error)
  return { values: Object.fromEntries(result.facts.map((item) => [item.key, item.value])), labels: Object.fromEntries(result.facts.map((item) => [item.key, item.label])) }
}

/** The next landing the screen's column offers (Sightline.tsx, `better`): the first hour that fits, moved on to where half the Sun's disc shows and Earth's center is above the skyline. */
async function columnNext(site: string, iso: string): Promise<string | null> {
  const flags = await data.flags(site)
  const first = betterDate(flags, hourOf(flags.start, iso), MISSION)
  if (!first) return null
  const at = locateHour(flags.start, first.landing)
  const sky = await data.scenario(site, at.month)
  const shares = sky.track.map((point) => point.sun_frac)
  const earthCenterAbove = sky.track.map((point) => point.earth_el - horizonAt(sky.earthHorizon ?? sky.horizon, point.earth_az) >= 0)
  return whenLabel(isoAt(flags.start, steadierLanding(flags, first.landing, MISSION, shares, first.landing - at.index, earthCenterAbove)))
}

/** The pipeline's own 10 m set for Connecting Ridge, cut down: the Sun's hours of 2027 and the Sun's share of disc for May 2027. */
const TEN = JSON.parse(readFileSync(new URL('./fixtures/connecting-ridge-10m.json', import.meta.url), 'utf8')) as { sun_runs_2027: number[]; sun_frac_2027_05: number[] }
/** A bucket holding the 10 m set as the site serves it for Connecting Ridge in 2027; every other year and site as at 2 m. */
const bucket: Bucket = {
  async get(key) {
    const stored = (value: unknown) => {
      const body = gzipSync(JSON.stringify(value))
      return { status: 200 as const, body: new Response(body).body, length: String(body.length), contentRange: null, etag: null }
    }
    const overview = /^tiles\/light\/heights\/10m\/overview\/(\d{4})\.json\.gz$/.exec(key)
    if (overview) {
      const year = JSON.parse(readFileSync(`${dataDir}/overview/${overview[1]}.json`, 'utf8')) as OverviewYear
      if (overview[1] === '2027') year.sites['connecting-ridge'].sun = TEN.sun_runs_2027
      return stored(year)
    }
    if (key === 'tiles/light/heights/10m/connecting-ridge/2027-05/track.json.gz') return stored(TEN.sun_frac_2027_05.map((sun_frac) => ({ sun_frac })))
    return null
  },
}
const high = siteData(dataDir, bucket)
/** Connecting Ridge, landing 6 May 2027 at 13:00, with the solar panel at 10 m: as the screen sends it to Scout. */
const TEN_M = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&hp=10&sc=0'

type Call = { name: string; args: Record<string, unknown> }
const answer = (text: string, more: Record<string, unknown> = {}): Call => ({ name: 'give_answer', args: { text, ...more } })
function scripted(...turns: Call[][]) {
  const generate = vi.fn<Model['generate']>()
  for (const turn of turns) generate.mockImplementationOnce(async () => claudeMessage({ content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...turn.map((made) => toolUse(made.name, made.args))] }))
  return { generate }
}
/** The real date in these tests: 15 November 2026, 02:00 UTC (the night Rodrigo asked). */
const REAL_NOW = Date.parse('2026-11-15T02:00:00Z')
const ask = (model: Model, hash: string, text: string, from = data, clock = REAL_NOW) => runChat({ turns: [{ role: 'user', text }], view: viewFrom(hash), viewHash: hash }, { model, data: from, wait: async () => {}, clock: () => clock })

describe('1. a solar panel at 10 m', () => {
  it('gives Scout the heights as facts he can cite, and the scenario\'s figures at them: 72 h of darkness, next landing 26 May 01:00, as the screen offers it at that height', async () => {
    const scene = await scenarioScene(TEN_M, viewFrom(TEN_M), high)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('panel_height')).toBe('10 m')
    expect(value('antenna_height')).toBe('2 m')
    expect(value('scenario_a_longest_time_without_sun')).toBe('72 h')
    expect(value('scenario_a_next_landing')).toBe('26 May 2027, 01:00 UTC')
    // At 2 m the same scenario reads 95 h and 21 June: the heights change the answer, as on the screen.
    const low = await scenarioScene(TEN_M.replace('&hp=10', ''), viewFrom(TEN_M), data)
    expect(low?.facts.find((item) => item.key === 'scenario_a_longest_time_without_sun')?.value).toBe('95 h')
    expect(low?.facts.find((item) => item.key === 'scenario_a_next_landing')?.value).toBe('22 June 2027, 07:00 UTC')
  })

  it('answers the question from those facts, with no number typed by the model', async () => {
    const model = scripted([answer('With the solar panel at {{r0.panel_height}}, the longest time without the Sun during this mission is {{r0.scenario_a_longest_time_without_sun}}. The next landing that fits is {{r0.scenario_a_next_landing}}.')])
    const outcome = await ask(model, TEN_M, 'My solar panel is 10 m above the ground. How long is the longest dark spell during my mission now?', high)
    expect(outcome.ok && outcome.reply.text).toBe('With the solar panel at 10 m, the longest time without the Sun during this mission is 72 h. The next landing that fits is 26 May 2027, 01:00 UTC.')
  })

  it('never answers with a bare apology while the figures are in hand: drafts that type the height are refused, and the figures are given', async () => {
    const typed = answer('With your panel at 10 m the dark spell is shorter.')
    const outcome = await ask(scripted([typed], [typed], [typed]), TEN_M, 'My solar panel is 10 m above the ground. How long is the longest dark spell during my mission now?', high)
    if (!outcome.ok) throw new Error('no answer')
    expect(outcome.fellBack).toBe(true)
    expect(outcome.reply.text).toMatch(/^Here is what the data says for the scenario on your screen\./)
    expect(outcome.reply.text).toContain('10 m')
    expect(outcome.reply.text).toContain('72 h')
    expect(outcome.reply.text).not.toMatch(/Sorry/)
    expect(outcome.reply.text).not.toMatch(/\.\./)
  })

  it('still apologises when there is nothing to quote: no tool ran and the view holds no scenario', async () => {
    const other = '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn'
    const typed = answer('It is 60%.')
    const outcome = await ask(scripted([typed], [typed], [typed]), other, 'How sunny is it?')
    expect(outcome.ok && outcome.reply.text).toMatch(/^Sorry, I couldn't answer that/)
  })
})

describe('2. the next landing that fits is the one the column offers', () => {
  it('is 11 May 13:00 at Apollo 11 from 6 May 2027, where the first hour that meets the limits has only a sliver of Sun', async () => {
    expect((await facts('next_landing', { site: 'apollo-11', time: '2027-05-06T13' })).values.next_landing).toBe('11 May 2027, 13:00 UTC')
    const there = (await facts('conditions_at', { site: 'apollo-11', time: '2027-05-06T13' })).values
    expect(there.next_landing).toBe('11 May 2027, 13:00 UTC')
    expect(there.next_landing_wait).toBe('5 d 0 h')
  })

  it('is 22 June 07:00 at Connecting Ridge from 6 May 2027, the hour the screen offers: 21 June 17:00 meets the limits on the edge of Earth alone, so the screen moves on to where Earth\'s center is above the skyline', async () => {
    const next = (await facts('next_landing', { site: 'connecting-ridge', time: '2027-05-06T13' })).values
    expect(next.next_landing).toBe('22 June 2027, 07:00 UTC')
    expect(next.wait).toBe('46 d 18 h')
  })

  it.each([
    ['apollo-11', '2027-05-06T13'],
    ['connecting-ridge', '2027-05-06T13'],
    ['connecting-ridge', '2027-05-01T00'],
    ['shackleton-rim', '2027-05-06T13'],
    ['de-gerlache-rim', '2028-03-10T06'],
    ['chandrayaan-3', '2027-07-01T00'],
    ['peak-near-shackleton', '2027-05-06T13'],
  ])('at %s from %s, the tools and the scenario on screen give the hour the column gives', async (site, time) => {
    const shown = await columnNext(site, `${time}:00:00Z`)
    expect(shown).not.toBeNull()
    expect((await facts('next_landing', { site, time })).values.next_landing).toBe(shown)
    expect((await facts('conditions_at', { site, time })).values.next_landing).toBe(shown)
    const [month, hour] = [time.slice(0, 7), hourOf(`${time.slice(0, 7)}-01T00:00:00Z`, `${time}:00:00Z`)]
    const link = `#a=${site}@${month}&t=${hour}&limits=14_24_99999_1_1&mode=plan&sc=0`
    const scene = await scenarioScene(link, viewFrom(link), data)
    expect(scene?.facts.find((item) => item.key === 'scenario_a_next_landing')?.value).toBe(shown)
  })

  it('leaves an hour that already fits where it is', async () => {
    const next = (await facts('next_landing', { site: 'connecting-ridge', time: '2027-06-21T17' })).values
    expect(next.next_landing).toBe('21 June 2027, 17:00 UTC')
    expect(next.wait).toMatch(/^none/)
  })
})

describe('3. the mission\'s own darkness and radio silence', () => {
  it('are given by conditions_at whether or not a limit is broken: 95 h and 169 h from 6 May 2027 at Connecting Ridge, as the screen shows', async () => {
    const there = (await facts('conditions_at', { site: 'connecting-ridge', time: '2027-05-06T13' })).values
    expect(there.mission_longest_without_sun).toBe('95 h')
    expect(there.mission_longest_without_earth).toBe('169 h')
    // No limit on radio silence in this mission: the figure is there all the same.
    expect(there.silence_limit).toBe('no limit')
  })

  it('are left out when the mission runs past the end of the data', async () => {
    expect((await facts('conditions_at', { site: 'connecting-ridge', time: '2049-12-28T00' })).values.mission_longest_without_sun).toBeUndefined()
  })
})

describe('4. facts that drop into a sentence', () => {
  it('give the next change as what and when, and as one phrase where nothing changes', async () => {
    const ridge = await facts('conditions_at', { site: 'connecting-ridge', time: '2027-05-06T13' })
    expect(ridge.values.sun_next_change).toBe('sunset')
    expect(ridge.values.sun_next_change_in).toBe('5 d 11 h')
    expect(ridge.values.earth_next_change).toBe('earthset')
    expect(ridge.values.earth_next_change_in).toBe('6 d 23 h')
    const apollo = await facts('conditions_at', { site: 'apollo-11', time: '2027-05-06T13' })
    expect(apollo.values.earth_next_change).toBe('no earthset through 2049')
    expect(apollo.values.earth_next_change_in).toBeUndefined()
    // The old whole phrases, which began with a capital, are gone.
    expect(ridge.values.sun_next).toBeUndefined()
  })

  it('give a scenario\'s verdict in a few words and each reason by itself, with no capital to start and no full stop', async () => {
    const two = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&sc=0'
    const scene = await scenarioScene(two, viewFrom(two), data)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('scenario_a_verdict')).toBe('does not meet the mission limits')
    expect(value('scenario_a_reason_1')).toBe('the Sun is gone for 95 h, past the 24 h limit')
    expect(value('scenario_b_reason_1')).toBe('the Sun is gone for 79 h, past the 24 h limit')
    // A listed site that is not on show has its figures and nothing that says they are missing.
    expect(value('scenario_b_figures')).toBeUndefined()
    expect(value('scenario_b_longest_time_without_sun')).toBe('79 h')
  })
})

describe('5. one fact for each limit', () => {
  it('names the mission\'s length, the darkness it survives and the radio silence it allows, each by itself', () => {
    expect(Object.fromEntries(limitFacts(SCREEN).map((item) => [item.key, item.value]))).toEqual({ mission_length: '14 days', dark_limit: '24 h', silence_limit: 'no limit' })
    expect(limitFacts({ ...SCREEN, maxSunGapH: 72, maxEarthGapH: 72 }).map((item) => item.value)).toEqual(['14 days', '3 days', '3 days'])
  })

  it('is in the view Scout is given and in what the tools return, beside the full list', async () => {
    const view = Object.fromEntries((await viewFacts(viewFrom('#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan'), data)).map((item) => [item.key, item.value]))
    expect(view.dark_limit).toBe('24 h')
    expect(view.silence_limit).toBe('no limit')
    expect(view.limits).toContain('14-day mission')
    expect((await facts('conditions_at', { site: 'connecting-ridge', time: '2027-05-06T13' })).values.dark_limit).toBe('24 h')
  })

  it('is asked for in the instructions: the full list only when the visitor asks for it, once and in a sentence of its own; otherwise one limit at most', () => {
    const rules = systemPrompt({ first_year: 2026, last_year: 2049 })
    expect(rules).toMatch(/Do not recite the mission limits\. Give the full list \(the limits fact\), once and as a sentence of its own, only when the visitor asks/)
    expect(rules).toMatch(/Otherwise name at most one limit, the one that decides the answer, by its own fact: mission_length, dark_limit or silence_limit/)
  })

  it('asks for an answer a planner can act on, with no cap on its words: the answer first, then the reason that decides it and what to try, at a length that follows the question', () => {
    const rules = systemPrompt({ first_year: 2026, last_year: 2049 })
    expect(rules).toMatch(/The first sentence answers the question that was asked, in the visitor's own terms/)
    expect(rules).toMatch(/Then give the one reason that decides it\. Then say what to try next: the nearest landing that fits, the limit that would change the verdict, or the site that does better\./)
    expect(rules).toMatch(/Length follows the question, with no limit set for you: a simple question gets a short answer, and a comparison, a plan or a proof gets all the room it needs\./)
    // No cap of any kind on an answer: no count of sentences or words anywhere in the rules.
    expect(rules).not.toMatch(/\b(two|three|four|five|six) sentences\b|sentences at most|\bwords in all\b|under about [a-z-]+ words/)
    expect(rules).toMatch(/name the winner first, then say why it wins, with the figure that separates the two, and how close the runner-up is/)
    expect(rules).not.toMatch(/sixty words|At most three sentences/)
    expect(rules).toMatch(/Say each figure, date and reason once\./)
    // The rule that every number is a filled reference stands exactly as it was.
    expect(rules).toMatch(/In your answer, every number, percentage, duration, date and time is a reference: write \{\{r2\.pct_sun\}\}, not the value\. The app fills in the value\. Never type a digit yourself, and never spell a number out in words\./)
  })

  it('gives a verdict\'s reason as a clause that joins a sentence, with its limit said in passing', () => {
    expect(reasonClause('The Sun is gone for 95 h during the mission; your limit is 24 h.')).toBe('the Sun is gone for 95 h, past the 24 h limit')
    expect(reasonClause('Earth is less than 2° above the terrain for 40 h during the mission; your limit is 24 h.')).toBe('Earth is less than 2° above the terrain for 40 h, past the 24 h limit')
    expect(reasonClause('The ground slopes 12.3°; your limit is 10°.')).toBe('the ground slopes 12.3°, past the 10° limit')
    expect(reasonClause('Earth is out of view at landing.')).toBe('Earth is out of view at landing')
  })
})

describe('6. a custom point', () => {
  it('says how far the nearest listed site is in meters under a kilometer, and that the screen\'s column is for the exact point', async () => {
    expect(distanceWords(0.223)).toBe('220 m')
    expect(distanceWords(2.44)).toBe('2.4 km')
    expect(distanceWords(42.3)).toBe('42 km')
    // A store with no terrain tiles: a custom point cannot be worked out, whatever tiles this machine holds.
    const noTiles = siteData(dataDir, { get: async () => null })
    const view = Object.fromEntries((await viewFacts(viewFrom('#a=-89.46,-137.2@2027-05&t=100&limits=14_72_72_1_1&mode=plan'), noTiles)).map((item) => [item.key, item.value]))
    expect(view.site_nearest).toBe('Connecting Ridge')
    expect(view.site_nearest_distance).toBe('220 m')
    expect(view.site).toMatch(/the column on the visitor's screen is worked out for the exact point, and your figures are for the nearest listed site/)
  })
})

describe('7. the Sun\'s elevation over a month', () => {
  it('is given as a range from level, as the Guide words it, so a negative height is never said as "above"', async () => {
    const may = await facts('month_summary', { site: 'connecting-ridge', month: '2027-05' })
    expect(may.values.sun_elevation_range).toBe('between −2.1° and −0.8° from level')
    expect(may.labels.highest_sun).toMatch(/minus means below level/)
  })
})

describe('8. how the numbers were checked', () => {
  const horizons = async () => ({ sun: { azDeg: 0, elDeg: 0 }, earth: { azDeg: 0, elDeg: 0 }, ephemeris: 'DE441', altKm: 1.958 })
  const check = async (site: string) => {
    const mine = (await data.scenario(site, '2027-05')).track[8 * 24 + 8]
    const result = await runTool('horizons_check', { site, time: '2027-05-09T08' }, { ...context, horizons: async () => ({ ...(await horizons()), sun: { azDeg: mine.sun_az, elDeg: mine.sun_el - 0.003 }, earth: { azDeg: mine.earth_az, elDeg: mine.earth_el } }) })
    if (!result.ok) throw new Error(result.error)
    return Object.fromEntries(result.facts.map((item) => [item.key, item.value]))
  }

  it('says the agreement as the screen does, "within 0.01°", and adds the check of every hour and the one against NASA\'s maps', async () => {
    const ridge = await check('connecting-ridge')
    expect(ridge.agreement).toBe('within 0.01°')
    expect(ridge.every_hour_count).toBe('210,384 hours')
    expect(ridge.every_hour_agreement).toBe('within 0.01°')
    expect(ridge.nasa_map_years).toBe('2020 to 2038')
    expect(ridge.nasa_map_sun).toBe('68.5%')
    expect(ridge.ours_sun_at_ground).toBe('64.8%')
    expect(ridge.nasa_map_earth).toBe('57.5%')
    expect(ridge.ours_earth_at_ground).toBe('57.0%')
  })

  it('says plainly where NASA\'s maps do not reach', async () => {
    const apollo = await check('apollo-11')
    expect(apollo.nasa_map).toBe('those maps cover the ground near the poles only, and this site is outside them')
    expect(apollo.nasa_map_sun).toBeUndefined()
    expect(apollo.every_hour_agreement).toMatch(/^within 0\.0\d°$/)
  })
})

describe('9. a button that changes the limits', () => {
  it('is for a visitor who asks what would change the verdict, not for one who asks why', () => {
    for (const message of ['What if my mission were only 3 days long?', 'What would one more day of battery change?', 'How could I make this landing fit?', 'Could a longer mission work here?', 'Try 72 h of darkness instead']) expect(asksToChangeLimits(message), message).toBe(true)
    for (const message of ["Why doesn't this landing fit?", 'What are my mission limits? How long can I go without hearing from Earth?', 'When is the next landing here that fits?', 'Is Earth in view from here right now?']) expect(asksToChangeLimits(message), message).toBe(false)
  })

  it('is dropped from an answer to "why", and the other buttons stay', async () => {
    const view = viewFrom('#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan')
    const raw = [{ type: 'open', site: 'connecting-ridge', time: '2027-06-21T17' }, { type: 'limits', max_sun_gap_h: 96 }]
    const flags = await data.flags('connecting-ridge')
    expect(buildActions(raw, view, await data.sites(), flags, [], false).map((action) => action.label)).toEqual(['Open Connecting Ridge at 21 June 2027, 17:00 UTC'])
    expect(buildActions(raw, view, await data.sites(), flags, [], true)).toHaveLength(2)
  })

  it('through the whole chat: kept when the visitor asks "what if", or when a tool had to try other limits; dropped otherwise', async () => {
    const hash = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&sc=0'
    const offer = { actions: [{ type: 'limits', max_sun_gap_h: 96 }] }
    const why = await ask(scripted([answer('It fails because {{r0.scenario_a_reason_1}}.', offer)]), hash, "Why doesn't this landing fit?")
    expect(why.ok && why.reply.text).toBe('It fails because the Sun is gone for 95 h, past the 24 h limit.')
    expect(why.ok && why.reply.actions).toEqual([])
    const whatIf = await ask(scripted([answer('With more battery it could fit.', offer)]), hash, 'What if the lander survived more darkness?')
    expect(whatIf.ok && whatIf.reply.actions.map((action) => action.label)).toEqual(['Change the limits: at most 4 days without the Sun'])
    const tried = await ask(scripted([{ name: 'next_landing', args: { site: 'connecting-ridge', time: '2027-05-06T13', max_sun_gap_h: 96 } }], [answer('The next landing is {{r1.next_landing}}.', offer)]), hash, 'And with a bigger battery?')
    expect(tried.ok && tried.reply.actions).toHaveLength(1)
  })
})

describe('10. the fact that no other site fits', () => {
  /** Apollo 11, landing 6 May 2027 at 13:00: it does not fit, and no other Apollo site fits on that date either. */
  const APOLLO = '#a=apollo-11@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&sc=0'

  it('is a clause that stands in a sentence: the old label-like value, with its colon, is gone from every fact Scout is given', async () => {
    const scene = await scenarioScene(APOLLO, viewFrom(APOLLO), data)
    expect(scene?.facts.find((item) => item.key === 'scenario_a_no_other_site_fits')?.value).toBe('no other Apollo site fits on 6 May 2027 either')
    // The exact fragment that reached a visitor ("On the date of scenario A, none: on this date no other site of the group meets them.").
    for (const item of scene?.facts ?? []) {
      expect(item.value, item.key).not.toMatch(/none: on this date/)
      expect(item.value, item.key).not.toMatch(/^none:/)
    }
  })

  it('reads as a sentence when Scout uses it', async () => {
    const outcome = await ask(scripted([answer('The next landing at Apollo 11 that fits is {{r0.scenario_a_next_landing}}, and {{r0.scenario_a_no_other_site_fits}}.')]), APOLLO, 'When is the next landing here that fits?')
    expect(outcome.ok && outcome.reply.text).toBe('The next landing at Apollo 11 that fits is 11 May 2027, 13:00 UTC, and no other Apollo site fits on 6 May 2027 either.')
  })

  it('where another site does fit, names the place and its distance, and says nothing of "none"', async () => {
    const first = '#a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1&mode=plan&sc=0'
    const scene = await scenarioScene(first, viewFrom(first), data)
    expect(scene?.facts.find((item) => item.key === 'scenario_a_fits_at_another_site')?.value).toBe('Peak near Shackleton, 42 km away')
    expect(scene?.facts.some((item) => item.key === 'scenario_a_no_other_site_fits')).toBe(false)
  })
})

describe('11. a link that carries the heights without the scenario mark', () => {
  /** A shared or older link: the solar panel at 10 m, and no `sc`. */
  const NO_MARK = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&hp=10'

  it('is read as the screen\'s link is: the heights are used, with the first scenario on show', async () => {
    const scene = await scenarioScene(NO_MARK, viewFrom(NO_MARK), high)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('scenario_on_screen')).toBe('A: a landing at Connecting Ridge on 6 May 2027, 13:00 UTC')
    expect(value('panel_height')).toBe('10 m')
    expect(value('scenario_a_longest_time_without_sun')).toBe('72 h')
    expect(value('scenario_a_next_landing')).toBe('26 May 2027, 01:00 UTC')
  })

  it('answers 72 h for the 10 m panel', async () => {
    const model = scripted([answer('With the solar panel at {{r0.panel_height}}, the longest time without the Sun during this mission is {{r0.scenario_a_longest_time_without_sun}}.')])
    const outcome = await ask(model, NO_MARK, 'My solar panel is 10 m above the ground. How long is the longest dark spell during my mission now?', high)
    expect(outcome.ok && outcome.reply.text).toBe('With the solar panel at 10 m, the longest time without the Sun during this mission is 72 h.')
  })

  it('where the heights\' files cannot be read, says plainly that its figures are for 2 m', async () => {
    const scene = await scenarioScene(NO_MARK, viewFrom(NO_MARK), data)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('heights_above_ground')).toMatch(/The scenario figures here are for 2 m/)
    expect(value('scenario_a_longest_time_without_sun')).toBe('95 h')
  })

  it('still leaves alone a link with neither the mark nor a height: another page\'s', async () => {
    const other = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan'
    expect(await scenarioScene(other, viewFrom(other), high)).toBeNull()
  })
})

describe('12. "where can a lander see Earth right now?", asked on the opening screen with no site chosen', () => {
  /** The opening screen's link at 10 December 2026, 00:00 UTC: it names the featured site only because a link must, and says so (`watch=1`). */
  const WATCH = '#a=connecting-ridge@2026-12&t=216&limits=14_24_99999_1_1&mode=plan&watch=1'
  const QUESTION = 'Where can a lander see Earth right now?'

  it('tells Scout that no site is chosen: nothing he is given names a site as the screen\'s', async () => {
    const view = await viewFacts(viewFrom(WATCH), data, null, true)
    expect(view.find((item) => item.key === 'no_site_chosen')?.value).toMatch(/no site chosen/)
    expect(view.some((item) => item.key === 'site')).toBe(false)
    expect(view.some((item) => /Connecting Ridge/.test(item.value))).toBe(false)
    expect(view.find((item) => item.key === 'time')?.value).toBe('10 December 2026, 00:00 UTC')
    // Not a scenario either, even where the link carries heights.
    expect(await scenarioScene(`${WATCH}&hp=10`, viewFrom(WATCH), high)).toBeNull()
  })

  it('says so in the instructions: never "the site on your screen", and words about the present mean the real date', () => {
    const rules = systemPrompt({ first_year: 2026, last_year: 2049 })
    expect(rules).toMatch(/If r0 has no_site_chosen.*Never say "the site on your screen"/)
    expect(rules).toMatch(/Words about the present \("now", "today", "tonight", "this month", "this year"\) mean the real date, whatever the time bar shows/)
    expect(rules).toMatch(/Every answer that depends on a date says the date it used, in passing/)
    expect(rules).toMatch(/call sites_in_view and lead with its list for that hour/)
    expect(rules).toMatch(/never guess what a site "should" see/)
  })

  it.each(['2026-12-10T00', '2027-05-06T13', '2031-08-20T05'])('at %s the tool\'s lists are the markers\' states for every listed site', async (time) => {
    const result = await runTool('sites_in_view', { time }, context)
    if (!result.ok) throw new Error(result.error)
    const value = (key: string) => result.facts.find((item) => item.key === key)?.value ?? ''
    const all = await data.allFlags()
    const sites = all.map(({ site }) => site)
    const hour = hourOf(all[0].flags.start, `${time}:00:00Z`)
    // What each site's marker shows at that hour, straight from its hours.
    const marker = new Map(all.map(({ site, flags }) => [site.id, stateAt(flags, hour)]))
    const where = (pass: (state: string) => boolean) => sites.filter((site) => pass(marker.get(site.id) ?? '')).map((site) => site.id).sort()
    const listed = (key: string) => sitesNamedIn(value(key), sites).sort()
    expect(listed('earth_in_view')).toEqual(where((state) => state === 'both' || state === 'earth'))
    expect(listed('sun_in_view')).toEqual(where((state) => state === 'both' || state === 'sun'))
    expect(listed('both_in_view')).toEqual(where((state) => state === 'both'))
    expect(listed('neither_in_view')).toEqual(where((state) => state === 'none'))
    expect(value('earth_in_view_count')).toBe(`${where((state) => state === 'both' || state === 'earth').length} of ${sites.length} listed sites`)
    // And each site by itself.
    const words = { both: 'the Sun and Earth', sun: 'the Sun only', earth: 'Earth only', none: 'neither' } as Record<string, string>
    for (const site of sites) expect(value(`at_${site.id.replace(/[^a-z0-9]+/g, '_')}`), site.id).toBe(words[marker.get(site.id) ?? ''])
  })

  it('with no time given, is for the hour the question is about, which comes with the request', async () => {
    const result = await runTool('sites_in_view', {}, { ...context, hourIso: '2026-12-10T00:00:00Z' })
    if (!result.ok) throw new Error(result.error)
    expect(result.facts.find((item) => item.key === 'time')?.value).toBe('10 December 2026, 00:00 UTC')
  })

  it('answers with the list for the real hour, says which hour, and the Moon rings the sites the first sentence names', async () => {
    const model = scripted([{ name: 'sites_in_view', args: {} }], [answer('Right now, {{r0.time}}, Earth is in view {{r1.earth_in_view}}. That is {{r1.earth_in_view_count}}.')])
    const outcome = await ask(model, WATCH, QUESTION)
    if (!outcome.ok) throw new Error('no answer')
    const text = outcome.reply.text
    // The real hour, not the time bar's 10 December.
    expect(text).toMatch(/^Right now, 15 November 2026, 02:00 UTC, Earth is in view /)
    expect(text).not.toMatch(/the site on your screen/)
    expect(text).not.toMatch(/should see/)
    // What Scout was sent says no site is chosen, and names none as the screen's.
    const sent = String(model.generate.mock.calls[0][0].messages[0].content)
    expect(sent).toMatch(/- no_site_chosen: /)
    expect(sent).not.toMatch(/^- site: /m)
    expect(sent).toMatch(/- date_asked: the present: the real date, not the time bar/)
    // The Moon rings the sites the first sentence names: exactly the sites with Earth in view at the real hour.
    const all = await data.allFlags()
    const sites = all.map(({ site }) => site)
    const hour = hourOf(all[0].flags.start, '2026-11-15T02:00:00Z')
    const withEarth = all.filter(({ flags }) => ['both', 'earth'].includes(stateAt(flags, hour))).map(({ site }) => site.id).sort()
    const ringed = ringedSites(outcome.reply, sites, () => null)
    expect([...ringed].sort()).toEqual(withEarth)
    expect([...ringed].sort()).toEqual(sitesNamedIn(firstSentence(text), sites).sort())
    expect(withEarth.length).toBeGreaterThan(1)
    // The time bar is on another day: one short sentence says so, and one button asks the same for the bar's date.
    expect(text).toMatch(/ The time bar is on 10 December 2026\.$/)
    expect(outcome.reply.ask).toEqual({ label: 'Ask for 10 December 2026', question: 'Where can a lander see Earth right now? (for the date on the time bar)' })
  })
})

describe('13. words about the present mean the real date; words about the screen mean the time bar', () => {
  /** The opening screen with its time bar run on to 10 December 2026, while the real date is 15 November 2026. */
  const WATCH = '#a=connecting-ridge@2026-12&t=216&limits=14_24_99999_1_1&mode=plan&watch=1'
  const sentTo = (model: ReturnType<typeof scripted>) => String(model.generate.mock.calls[0][0].messages[0].content)

  it('decides which date a question is about from its words', () => {
    for (const question of ['Where can a lander see Earth right now?', 'Which site has the most Sun this month?', 'Is the Sun up today?', 'What can I see tonight?', 'Which site is best this year?', 'Is Earth in view from here right now?']) {
      expect(dateBasis(question, false), question).toBe('present')
      expect(asksAboutPresent(question), question).toBe(true)
    }
    for (const question of ['What about at this time?', 'And on this date?', 'Does this landing fit?', 'How long is the longest dark spell during my mission now?', 'Where can a lander see Earth right now? (for the date on the time bar)']) {
      expect(dateBasis(question, false), question).toBe('screen')
      expect(asksAboutPresent(question), question).toBe(false)
    }
    // With no word about time: the plan on screen in Plan, the present on the opening screen, and no note either way.
    expect(dateBasis('Which site is best?', false)).toBe('screen')
    expect(dateBasis('Which site is best?', true)).toBe('present')
    expect(asksAboutPresent('Which site is best?')).toBe(false)
  })

  it('"which site has the most Sun this month" answers for November 2026 and says so, with the bar on 10 December', async () => {
    const model = scripted([{ name: 'best_sites', args: { month: '2026-11', measure: 'sun' } }], [answer('This month, {{r0.month}}, the Sun is up most at {{r1.best_sites}}, with {{r1.best_value}}.')])
    const outcome = await ask(model, WATCH, 'Which site has the most Sun this month?')
    if (!outcome.ok) throw new Error('no answer')
    expect(outcome.reply.text).toMatch(/^This month, November 2026, the Sun is up most at /)
    expect(outcome.reply.text).toMatch(/ The time bar is on 10 December 2026\.$/)
    expect(outcome.reply.ask?.label).toBe('Ask for 10 December 2026')
    // Scout was handed November as the month to use, and December only as the time bar's.
    expect(sentTo(model)).toMatch(/- month: November 2026/)
    expect(sentTo(model)).toMatch(/- year: 2026/)
    expect(sentTo(model)).toMatch(/- time_bar: 10 December 2026, 00:00 UTC/)
    expect(sentTo(model)).not.toMatch(/- month: December 2026/)
  })

  it('"what about at this time" uses the time bar\'s hour, with no note', async () => {
    const model = scripted([{ name: 'sites_in_view', args: {} }], [answer('At that time, {{r0.time}}, Earth is in view {{r1.earth_in_view}}.')])
    const outcome = await ask(model, WATCH, 'What about at this time?')
    if (!outcome.ok) throw new Error('no answer')
    expect(outcome.reply.text).toMatch(/^At that time, 10 December 2026, 00:00 UTC, Earth is in view /)
    expect(outcome.reply.text).not.toMatch(/The time bar is on/)
    expect(outcome.reply.ask).toBeUndefined()
    expect(sentTo(model)).toMatch(/- date_asked: what the screen shows: the date on the time bar/)
    expect(sentTo(model)).toMatch(/- real_time: 15 November 2026, 02:00 UTC/)
  })

  it('the button\'s own question, asked, is about the time bar', async () => {
    const model = scripted([{ name: 'sites_in_view', args: {} }], [answer('On the time bar\'s date, {{r0.time}}, Earth is in view {{r1.earth_in_view}}.')])
    const outcome = await ask(model, WATCH, 'Where can a lander see Earth right now? (for the date on the time bar)')
    expect(outcome.ok && outcome.reply.text).toMatch(/^On the time bar's date, 10 December 2026, 00:00 UTC, /)
    expect(outcome.ok && outcome.reply.ask).toBeUndefined()
  })

  it('adds no note when the time bar is within a day of the real date', async () => {
    const near = '#a=connecting-ridge@2026-11&t=345&limits=14_24_99999_1_1&mode=plan&watch=1'
    const outcome = await ask(scripted([{ name: 'sites_in_view', args: {} }], [answer('Right now, {{r0.time}}, Earth is in view {{r1.earth_in_view}}.')]), near, 'Where can a lander see Earth right now?')
    expect(outcome.ok && outcome.reply.text).not.toMatch(/The time bar is on/)
    expect(outcome.ok && outcome.reply.ask).toBeUndefined()
  })

  it('takes the hour the page sent with the question when it is near the server\'s clock, and the server\'s own when it is not', () => {
    expect(realHourIso('#a=connecting-ridge@2026-12&t=216&watch=1&now=2026-11-15T03', REAL_NOW)).toBe('2026-11-15T03:00:00Z')
    expect(realHourIso('#a=connecting-ridge@2026-12&t=216&watch=1&now=2031-01-01T00', REAL_NOW)).toBe('2026-11-15T02:00:00Z')
    expect(realHourIso('#a=connecting-ridge@2026-12&t=216&watch=1&now=nonsense', REAL_NOW)).toBe('2026-11-15T02:00:00Z')
    expect(realHourIso(undefined, Date.parse('2026-11-15T02:40:00Z'))).toBe('2026-11-15T03:00:00Z')
  })

  it('says so plainly when the real date is outside the data, and answers for the nearest date inside it', async () => {
    const model = scripted([answer('The real date is outside the data, so this is for {{r0.time}}.')])
    const outcome = await ask(model, WATCH, 'Is the Sun up right now?', data, Date.parse('2055-03-03T10:00:00Z'))
    expect(outcome.ok && outcome.reply.text).toMatch(/^The real date is outside the data, so this is for 31 December 2049, 23:00 UTC\./)
    expect(sentTo(model)).toMatch(/- real_date_outside_data: the real date, 3 March 2055, 10:00 UTC, is outside the data; this is for the nearest date inside it/)
  })

  it('"Show me" and "Plan this" under such an answer open the date it was about, not the time bar\'s', async () => {
    const model = scripted([answer('Right now, {{r0.time}}, look at Shackleton Rim.', { actions: [{ type: 'open', site: 'shackleton-rim' }] })])
    const outcome = await ask(model, WATCH, 'Where is the Sun up right now?')
    if (!outcome.ok) throw new Error('no answer')
    // 15 November 2026, 02:00 UTC is hour 338 of November.
    expect(outcome.reply.actions[0].hash).toMatch(/^#a=shackleton-rim@2026-11&t=338&/)
    expect(outcome.reply.actions[0].label).toBe('Open Shackleton Rim, November 2026')
  })

  it('in Plan, a question with no word about time is about the plan on screen, as before', async () => {
    const plan = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&sc=0'
    const model = scripted([answer('It fails because {{r0.scenario_a_reason_1}}.')])
    const outcome = await ask(model, plan, "Why doesn't this landing fit?")
    expect(outcome.ok && outcome.reply.text).toBe('It fails because the Sun is gone for 95 h, past the 24 h limit.')
    expect(sentTo(model)).toMatch(/- time: 6 May 2027, 13:00 UTC/)
  })
})

describe('14. the verdict Scout is given is the screen\'s own, in its three states', () => {
  const link = (site: string, month: string, index: number) => `#a=${site}@${month}&t=${index}&limits=14_24_99999_1_1&mode=plan&sc=0`
  const of = async (hash: string) => Object.fromEntries(((await scenarioScene(hash, viewFrom(hash), data))?.facts ?? []).map((item) => [item.key, item.value]))

  it('calls the judge\'s landing marginal, with the screen\'s reason and Earth\'s place at landing', async () => {
    // Connecting Ridge, 5 February 2027, 17:00 UTC: every limit is met, but only the edge of Earth is in view.
    const values = await of(link('connecting-ridge', '2027-02', 4 * 24 + 17))
    expect(values.scenario_a_verdict).toBe('meets the mission limits, but only as a marginal fit')
    expect(values.scenario_a_verdict_words).toBe('Fits, marginal')
    expect(values.scenario_a_marginal_reason_1).toBe('only the edge of Earth is in view at landing')
    expect(values.scenario_a_earth_at_landing).toMatch(/^\d+\.\d° below the skyline$/)
    expect(values.scenario_a_reason_1).toBeUndefined()
  })

  it('says a plain fit and a miss as before, with nothing about a margin', async () => {
    // 21 June 2027, 17:00 is the screen's "next landing that fits" from 6 May, a marginal one; a day later the Sun and Earth are well up.
    const flags = await data.flags('connecting-ridge')
    const fits = await of(link('connecting-ridge', '2027-06', 23 * 24 + 17))
    const misses = await of(link('connecting-ridge', '2027-05', 133))
    expect(misses.scenario_a_verdict).toBe('does not meet the mission limits')
    expect(misses.scenario_a_verdict_words).toBe('Does not fit the mission')
    expect(misses.scenario_a_marginal_reason_1).toBeUndefined()
    expect(['meets the mission limits', 'meets the mission limits, but only as a marginal fit']).toContain(fits.scenario_a_verdict)
    if (fits.scenario_a_verdict === 'meets the mission limits') expect(fits.scenario_a_marginal_reason_1).toBeUndefined()
    expect(flags.start).toBe('2026-01-01T00:00:00Z')
  })

  it('marks a landing marginal exactly when the screen\'s rule does: Earth in view with its centre below the skyline, or under half the Sun\'s disc', async () => {
    const { horizonAt } = await import('../../src/lib/customModel')
    const { marginalReasons } = await import('../../src/lib/sightlineSky')
    const view = await data.scenario('connecting-ridge', '2027-02')
    for (const index of [100, 113, 130, 200, 400]) {
      const point = view.track[index]
      const earthAbove = point.earth_el - horizonAt(view.earthHorizon ?? view.horizon, point.earth_az)
      const values = await of(link('connecting-ridge', '2027-02', index))
      if (values.scenario_a_verdict === 'does not meet the mission limits') continue
      const want = marginalReasons(point.sun_frac, earthAbove < 0 ? 0.25 : 0.75, point.earth_up)
      expect(values.scenario_a_verdict === 'meets the mission limits, but only as a marginal fit', String(index)).toBe(want.length > 0)
      expect(values.scenario_a_marginal_reason_1, String(index)).toBe(want[0])
    }
  })

  it('tells Scout to state that verdict and no other', () => {
    const prompt = systemPrompt([{ id: 'connecting-ridge', name: 'Connecting Ridge' }] as never)
    expect(prompt).toContain('State that verdict and no other')
    expect(prompt).toContain('never call a marginal fit a fit "with room to spare"')
  })
})

describe('15. "which of the four south-pole sites is best in 2027, and when?" is one result', () => {
  it('ranks the four south pole ridge sites over the year by landing days, each with its own best month', async () => {
    const { values } = await facts('best_sites_in_year', { year: 2027, measure: 'landing', group: 'south_pole' })
    expect(values.sites_ranked).toBe('the south pole ridge sites (4)')
    const places = [1, 2, 3, 4].map((i) => values[`place_${i}_site`])
    expect([...places].sort()).toEqual(['Connecting Ridge', 'Peak near Shackleton', 'Shackleton Rim', 'de Gerlache Rim'].sort())
    for (const i of [1, 2, 3, 4]) {
      expect(values[`place_${i}_value`]).toMatch(/^\d+ of 365 days$/)
      expect(values[`place_${i}_best_month`]).toMatch(/2027/)
    }
    // Ranked: each place has at least as many days as the next.
    const days = [1, 2, 3, 4].map((i) => Number(values[`place_${i}_value`].split(' ')[0]))
    expect(days).toEqual([...days].sort((a, b) => b - a))
    expect(values.best_sites.split(/, | and /)).toContain(places[0])
  })

  it('gives each site the days its twelve months add up to, and the best month the month ranking gives', async () => {
    const year = await facts('best_sites_in_year', { year: 2027, measure: 'landing', group: 'south_pole' })
    const place = [1, 2, 3, 4].find((i) => year.values[`place_${i}_site`] === 'de Gerlache Rim') as number
    const months = await facts('best_months', { site: 'de-gerlache-rim', measure: 'landing', year: 2027, count: 6 })
    expect(year.values[`place_${place}_best_month`]).toContain(months.values.best_months.split(/, | and | to /)[0].split(' ')[0])
    expect(year.values[`place_${place}_best_month`]).toContain(months.values.best_value)
  })

  it('ranks all thirteen listed sites when no group is named, and refuses a group or year it does not have', async () => {
    const all = await facts('best_sites_in_year', { year: 2027, measure: 'sun' })
    expect(all.values.sites_ranked).toBe('all 13 listed sites')
    expect(all.values.place_1_value).toMatch(/^\d+% of the year$/)
    expect((await runTool('best_sites_in_year', { year: 2027, measure: 'sun', group: 'mars' }, context)).ok).toBe(false)
    expect((await runTool('best_sites_in_year', { year: 1999, measure: 'sun' }, context)).ok).toBe(false)
  })
})

describe('17. facts a better answer is made from: why, how close, and what to try', () => {
  const of = async (hash: string) => Object.fromEntries(((await scenarioScene(hash, viewFrom(hash), data))?.facts ?? []).map((item) => [item.key, item.value]))

  it('a marginal landing comes with the next landing that has margin, and how much later it is', async () => {
    // Connecting Ridge, 5 February 2027, 17:00 UTC: only the edge of Earth is in view at landing.
    const hash = '#a=connecting-ridge@2027-02&t=113&limits=14_24_99999_1_1&mode=plan&sc=0'
    const values = await of(hash)
    expect(values.scenario_a_verdict_words).toBe('Fits, marginal')
    expect(values.scenario_a_landing_with_margin).toMatch(/^\d+ February 2027, \d\d:00 UTC$/)
    expect(values.scenario_a_landing_with_margin_wait).toMatch(/^(\d+ h|\d+ d \d+ h)$/)
    // That landing, as a scenario of its own, is a plain fit: nothing marginal about it.
    const flags = await data.flags('connecting-ridge')
    const later = hourOf(flags.start, new Date(`${values.scenario_a_landing_with_margin.replace(' UTC', '').replace(',', '')} UTC`).toISOString().slice(0, 13) + ':00:00Z')
    const { month, index } = locateHour(flags.start, later)
    expect((await of(`#a=connecting-ridge@${month}&t=${index}&limits=14_24_99999_1_1&mode=plan&sc=0`)).scenario_a_verdict_words).toBe('Fits the mission')
    // A plain fit and a miss carry no such fact.
    expect((await of('#a=connecting-ridge@2027-05&t=132&limits=14_24_99999_1_1&mode=plan&sc=0')).scenario_a_landing_with_margin).toBeUndefined()
  })

  it('every scenario that does not fit has its own next landing, not only the one on show; and one fact says which scenarios fit', async () => {
    const two = '#a=connecting-ridge@2027-05&t=132&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-06-21T17&sc=0'
    const values = await of(two)
    expect(values.scenarios_that_fit).toBe('neither scenario meets the mission limits')
    expect(values.scenario_a_next_landing).toBe('22 June 2027, 07:00 UTC')
    expect(values.scenario_b_next_landing).toMatch(/2027, \d\d:00 UTC$/)
    expect(values.scenario_b_next_landing_wait).toMatch(/^(\d+ h|\d+ d \d+ h)$/)
    // The other site of the group is said only for the scenario on show.
    expect(Object.keys(values).filter((key) => /no_other_site_fits|fits_at_another_site/.test(key))).toEqual([expect.stringMatching(/^scenario_a_/)])
    // A scenario is named in a sentence by its own site and landing time.
    expect(values.scenario_b_site).toBe('Shackleton Rim')
    expect(values.scenario_b_landing).toBe('21 June 2027, 17:00 UTC')
    // One scenario alone has no such comparison.
    expect((await of('#a=connecting-ridge@2027-05&t=132&limits=14_24_99999_1_1&mode=plan&sc=0')).scenarios_that_fit).toBeUndefined()
  })

  it('a landing that breaks only a limit on time comes with the change of limits that would make it fit; one that fails at touchdown does not', async () => {
    // Connecting Ridge, 6 May 2027, 12:00: the Sun is gone for 95 h against a limit of 24 h.
    const values = await of('#a=connecting-ridge@2027-05&t=132&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-06-21T17&sc=0')
    expect(values.scenario_a_reason_1).toBe('the Sun is gone for 95 h, past the 24 h limit')
    expect(values.scenario_a_fits_if).toBe('at least 3 d 23 h without the Sun')
    // With that limit the same landing does fit.
    expect((await of('#a=connecting-ridge@2027-05&t=132&limits=14_95_99999_1_1&mode=plan&sc=0')).scenario_a_verdict).toMatch(/^meets the mission limits/)
    // Shackleton Rim, 21 June 17:00: Earth is out of view at landing, which no limit mends.
    expect(values.scenario_b_reason_1).toBe('Earth is out of view at landing')
    expect(values.scenario_b_fits_if).toBeUndefined()
  })

  it('an answer has no limit on its length: a long one is filled and passed like any other', () => {
    const book = new Map([['r0', [{ key: 'site', label: 'Site', value: 'Connecting Ridge' }]]])
    const long = Array.from({ length: 40 }, () => 'At {{r0.site}} the answer needs room, so it takes it.').join(' ')
    const rendered = renderAnswer(long, book, [])
    expect(rendered.ok && rendered.text.length).toBeGreaterThan(1500)
  })

  it('says which scenarios fit as a clause, in every mix of the three verdicts', () => {
    const states = (text: string) => [...text].map((state, i) => ({ letter: 'ABCD'[i], state: ({ f: 'fits', m: 'marginal', x: 'miss' } as const)[state as 'f' | 'm' | 'x'] }))
    expect(fitWords(states('xx'))).toBe('neither scenario meets the mission limits')
    expect(fitWords(states('xxx'))).toBe('none of the scenarios meets the mission limits')
    expect(fitWords(states('ff'))).toBe('both scenarios meet the mission limits')
    expect(fitWords(states('fx'))).toBe('only A meets the mission limits; B does not')
    expect(fitWords(states('xm'))).toBe('only B meets the mission limits, and only marginally; A does not')
    expect(fitWords(states('fm'))).toBe('A meets the mission limits and B only marginally')
    expect(fitWords(states('fmx'))).toBe('A meets the mission limits and B only marginally; C does not')
    expect(fitWords(states('ffxx'))).toBe('A and B meet the mission limits; C and D do not')
  })

  const SOUTH: Record<string, string> = { 'Connecting Ridge': 'connecting-ridge', 'Peak near Shackleton': 'peak-near-shackleton', 'Shackleton Rim': 'shackleton-rim', 'de Gerlache Rim': 'de-gerlache-rim' }

  it('the year\'s ranking says how far behind the runner-up is and gives each place what explains it: Sun, longest dark stretch, Earth', async () => {
    const { values } = await facts('best_sites_in_year', { year: 2027, measure: 'landing', group: 'south_pole' })
    expect(values.runner_up_site).toBe(values.place_2_site)
    expect(values.runner_up_gap).toMatch(/^\d+ days? behind$/)
    // A place's best month sits in a sentence: "…, each with 19 days on which a landing fits".
    expect(values.place_1_best_month).toMatch(/^[A-Za-z, ]+ 2027, (each )?with \d+ days? on which a landing fits$/)
    const lead = Number(values.place_1_value.split(' ')[0]) - Number(values.place_2_value.split(' ')[0])
    expect(values.runner_up_gap).toBe(`${lead} ${lead === 1 ? 'day' : 'days'} behind`)
    for (const i of [1, 2, 3, 4]) {
      expect(values[`place_${i}_sun_share`]).toMatch(/^\d+%$/)
      // The same figures as the site's own year file, which the Guide's "Why this site is hard" reads.
      const year = (JSON.parse(readFileSync(`${dataDir}/${SOUTH[values[`place_${i}_site`]]}/year-2027.json`, 'utf8')) as { years: { year: number; pct_sun: number; pct_earth: number; max_sun_gap_h: number }[] }).years.find((one) => one.year === 2027)!
      expect(values[`place_${i}_sun_share`]).toBe(`${Math.round(year.pct_sun)}%`)
      expect(values[`place_${i}_earth_share`]).toBe(`${Math.round(year.pct_earth)}%`)
      expect(values[`place_${i}_longest_dark`]).toBe(year.max_sun_gap_h < 48 ? `${year.max_sun_gap_h} h` : `${Math.floor(year.max_sun_gap_h / 24)} d ${year.max_sun_gap_h % 24} h`)
      expect(values[`place_${i}_earth_share`]).toMatch(/^\d+%$/)
      expect(values[`place_${i}_longest_dark`]).toMatch(/^(\d+ h|\d+ d \d+ h)$/)
    }
  })

  it('a month\'s landing stretches are counted in words that sit in a sentence', async () => {
    const { values } = await facts('landing_windows', { site: 'connecting-ridge', month: '2027-05', mission_days: 3 })
    expect(values.window_count).toMatch(/^\d+ stretch(es)?$/)
  })
})

describe('18. a site may be called by the short form of its name', () => {
  it('knows the short forms: the name before its bracket, each part of a joined name, and a letter joined to a number', () => {
    expect(nameForms('Chandrayaan-3 (India)')).toEqual(expect.arrayContaining(['Chandrayaan-3 (India)', 'Chandrayaan-3', 'India']))
    expect(nameForms("Chang'e 4 (China, far side)")).toEqual(expect.arrayContaining(["Chang'e 4 (China, far side)", "Chang'e 4"]))
    expect(nameForms('IM-2 Athena')).toEqual(expect.arrayContaining(['IM-2 Athena', 'IM-2']))
    expect(nameForms('Apollo 11')).toEqual(['Apollo 11'])
    // Never a bare number: that would let the model type one.
    for (const name of ['Blue Ghost Mission 1', 'Apollo 17', "Chang'e 4 (China, far side)", 'Chandrayaan-3 (India)']) expect(nameForms(name).every((form) => /[A-Za-z]/.test(form))).toBe(true)
  })

  it('"the Chandrayaan-3 site" is an answer, not a refusal that ends in the raw list of facts; a number of the model\'s own is still refused', async () => {
    const allowed = (await data.sites()).flatMap((site) => nameForms(site.name))
    const book = new Map([['r1', [{ key: 'latitude', label: 'Latitude', value: '69.374°S' }]]])
    expect(renderAnswer('The Chandrayaan-3 site is at {{r1.latitude}}.', book, allowed)).toEqual({ ok: true, text: 'The Chandrayaan-3 site is at 69.374°S.' })
    expect(renderAnswer("Chang'e 4 and IM-2 are both listed, at {{r1.latitude}}.", book, allowed).ok).toBe(true)
    expect(renderAnswer('The Chandrayaan-4 site is at {{r1.latitude}}.', book, allowed).ok).toBe(false)
    expect(renderAnswer('The Chandrayaan-3 site is 3 km away, at {{r1.latitude}}.', book, allowed).ok).toBe(false)
    // Through the whole chat: the model's draft with the short name reaches the visitor as written.
    const outcome = await ask(scripted([{ name: 'site_info', args: { site: 'chandrayaan-3' } }], [answer('The Chandrayaan-3 site is at {{r1.latitude}}, {{r1.longitude}}.')]), '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn', 'Where exactly is the Chandrayaan-3 site?')
    expect(outcome.ok && outcome.reply.text).toBe('The Chandrayaan-3 site is at 69.374°S, 32.320°E.')
    expect(outcome.ok && outcome.fellBack).toBe(false)
  })
})

describe('19. a teacher\'s "why" is answered from the Guide\'s own explanations', () => {
  it('the lookup returns the Guide\'s sentences as they stand, and the site\'s own figures for the month beside them', async () => {
    const { values } = await facts('explain_the_pole', { site: 'connecting-ridge', month: '2027-05' })
    expect(values.why_sun_and_earth_are_low).toBe(SUN_AND_EARTH_SKIM)
    expect(values.how_the_sun_moves).toBe(SUN_CIRCLES)
    expect(values.moon_and_earth_days).toBe(TILT_AND_TURN)
    expect(values.why_earth_rises_and_sets).toBe(`The Moon has a ${LIBRATION}. ${EARTH_STAYS_PUT}`)
    expect(values.why_dates_matter).toBe(`The Moon has seasons too. ${SEASONS}`)
    expect(TILT_AND_TURN).toContain(values.moon_tilt)
    expect(TILT_AND_TURN).toContain(values.earth_tilt)
    expect(values.site).toBe('Connecting Ridge')
    expect(values.month).toBe('May 2027')
    // The site's figures are the ones the Guide's "A day here" card reads from the same hourly track.
    const track = (await data.scenario('connecting-ridge', '2027-05')).track
    // Said with its side, never with a minus sign: "−0.8° above a level horizon" is what a bare figure made.
    const highest = Math.round(Math.max(...track.map((point) => point.sun_el)) * 10) / 10
    expect(values.sun_highest_here).toBe(`${degWords(Math.abs(highest))} ${highest < 0 ? 'below' : 'above'} a level horizon`)
    expect(values.sun_highest_here).toBe('0.8° below a level horizon')
    for (const key of ['sun_highest_here', 'earth_lowest_here', 'earth_highest_here']) expect(values[key]).toMatch(/^\d+\.\d° (above|below) a level horizon$/)
    expect(values.sun_rises_here).toMatch(/^(never rises|does not rise, because it is already up|rises (once|twice|\d+ times))$/)
    expect(values.longest_dark_here).toMatch(/^(\d+ h|\d+ d \d+ h|none: it never goes dark)$/)
  })

  it('the Guide shows those same sentences from the same place, so the two cannot drift', () => {
    const page = (name: string) => readFileSync(fileURLToPath(new URL(`../../src/shell/guide/${name}.tsx`, import.meta.url)), 'utf8')
    expect(page('GuideChallenge')).toContain('intro={SUN_AND_EARTH_SKIM}')
    expect(page('GuideSolution')).toContain('{SUN_CIRCLES}')
    expect(page('GuideEarthDay')).toContain('{TILT_AND_TURN}')
    expect(page('GuideProof')).toContain('{LIBRATION}')
    expect(page('GuideProof')).toContain('{EARTH_STAYS_PUT}')
    expect(page('GuideProof')).toContain('{SEASONS}')
    // Not typed out a second time in any of them.
    for (const name of ['GuideChallenge', 'GuideSolution', 'GuideEarthDay', 'GuideProof']) expect(page(name)).not.toMatch(/never climb|once every 29\.5 Earth days|tilts only 1\.5°|slow wobble/)
  })

  it('is asked for in the instructions: a "why" is answered, never declined, and only what is truly outside the data is turned down', () => {
    const rules = systemPrompt({ first_year: 2026, last_year: 2049 })
    expect(rules).toMatch(/A "why" or "how does it work" question about the Moon's south pole is inside what you know/)
    expect(rules).toMatch(/Call explain_the_pole for the site on the visitor's screen and its month/)
    expect(rules).toMatch(/Never say you cannot explain these\./)
    expect(rules).toMatch(/truly outside the data \(costs, weather, other years, other worlds, a lander's hardware, other missions' plans\)/)
    expect(rules).not.toMatch(/other worlds, general knowledge\)/)
  })

  it('through the whole chat: the explanation and the site\'s figure reach the visitor, with no number typed by the model', async () => {
    const model = scripted([{ name: 'explain_the_pole', args: { site: 'connecting-ridge', month: '2027-05' } }], [answer('{{r1.why_sun_and_earth_are_low}} At {{r1.site}} in {{r1.month}} the Sun gets no higher than {{r1.sun_highest_here}}.')])
    const outcome = await ask(model, '#a=connecting-ridge@2027-05&t=132&limits=14_24_99999_1_1&mode=plan&sc=0', 'Why is the Sun so low here?')
    expect(outcome.ok && outcome.fellBack).toBe(false)
    expect(outcome.ok && outcome.reply.text).toMatch(/^Near the Moon’s south pole the Sun and Earth never climb\. They skim the horizon, .* At Connecting Ridge in May 2027 the Sun gets no higher than 0\.8° below a level horizon\.$/)
  })
})

describe('20. a heading is never what a reference fills in', () => {
  it('a ranked option\'s "why" is a clause that follows its name, not the list\'s tags', async () => {
    expect(whyWords(['Meets your limits', 'Shortest time without Sun on this list'])).toBe('meets the limits and has the shortest time without the Sun of these options')
    expect(whyWords(['The Sun is gone for 95 h during the mission; your limit is 24 h.'])).toBe('does not meet the limits because the Sun is gone for 95 h, past the 24 h limit')
    expect(whyWords(['Earth is out of view at landing.', 'The Sun is gone for 41 h during the mission; your limit is 24 h.', 'Shortest time without Earth on this list'])).toBe(
      'does not meet the limits because Earth is out of view at landing and the Sun is gone for 41 h, past the 24 h limit and has the shortest time without Earth of these options',
    )
    const { values } = await facts('rank_options', { options: [{ site: 'connecting-ridge', time: '2027-05-06T12' }, { site: 'shackleton-rim', time: '2027-06-21T17' }, { site: 'de-gerlache-rim', time: '2027-06-01T00' }] })
    const whys = Object.entries(values).filter(([key]) => key.endsWith('_why')).map(([, value]) => value)
    expect(whys.length).toBe(3)
    for (const why of whys) {
      expect(why).toMatch(/^(meets the limits|does not meet the limits because )/)
      expect(why).not.toMatch(/on this list|Meets your limits|Shortest/)
    }
  })

  it('no fact of any tool has a value that is one of its own result\'s labels, or that reads as a tag from a list', async () => {
    const samples: [string, Record<string, unknown>][] = [
      ['site_info', { site: 'chandrayaan-3' }],
      ['conditions_at', { site: 'connecting-ridge', time: '2027-06-20T00' }],
      ['month_summary', { site: 'connecting-ridge', month: '2027-05' }],
      ['year_summary', { site: 'connecting-ridge', year: 2027 }],
      ['best_months', { site: 'shackleton-rim', measure: 'sun', year: 2027 }],
      ['best_sites', { month: '2027-07', measure: 'sun' }],
      ['best_sites_in_year', { year: 2027, measure: 'landing', group: 'south_pole' }],
      ['compare_sites', { site_a: 'shackleton-rim', site_b: 'apollo-11', month: '2028-03' }],
      ['landing_windows', { site: 'shackleton-rim', month: '2027-08' }],
      ['next_landing', { site: 'connecting-ridge', time: '2027-05-06T12' }],
      ['rank_options', { options: [{ site: 'connecting-ridge', time: '2027-05-06T12' }, { site: 'shackleton-rim', time: '2027-06-21T17' }] }],
      ['explain_the_pole', { site: 'connecting-ridge', month: '2027-05' }],
    ]
    for (const [tool, args] of samples) {
      const { values, labels } = await facts(tool, args)
      const names = new Set(Object.values(labels))
      for (const [key, value] of Object.entries(values)) {
        expect(names.has(value), `${tool}.${key} is a label: ${value}`).toBe(false)
        expect(value, `${tool}.${key}`).not.toMatch(/ on this list$|^Meets your limits/)
      }
    }
  })

  it('and a reference is filled with the fact\'s value, whatever its label says', () => {
    const book = new Map([['r1', [{ key: 'option_1_why', label: 'Shortest time without Sun on this list', value: 'meets the limits' }]]])
    expect(renderAnswer('Connecting Ridge {{r1.option_1_why}}.', book, ['Connecting Ridge'])).toEqual({ ok: true, text: 'Connecting Ridge meets the limits.' })
  })
})

describe('16. an answer may repeat the amounts the visitor typed, and still no number of its own', () => {
  it('reads the amounts out of a question as they were written', () => {
    expect(visitorsAmounts('Which of the four south-pole sites is best for a 14-day mission in 2027, and when?')).toEqual(['14-day'])
    expect(visitorsAmounts('What if my mission were only 3 days long and I could go 48 h dark?')).toEqual(['3 days', '48 h'])
    expect(visitorsAmounts('Which site is best?')).toEqual([])
    // A height is not one of them: it is cited from the fact that holds it.
    expect(visitorsAmounts('How long is the dark spell with my panel at 10 m?')).toEqual([])
  })

  it('lets "for a 14-day mission" through, and still refuses a figure typed by hand', () => {
    const book = new Map([['r1', [{ key: 'best_sites', label: 'The best site', value: 'de Gerlache Rim' }]]])
    const own = visitorsAmounts('Which site is best for a 14-day mission?')
    expect(renderAnswer('For a 14-day mission {{r1.best_sites}} is best.', book, own).ok).toBe(true)
    expect(renderAnswer('For a 14-day mission {{r1.best_sites}} is best, with 21 days.', book, own).ok).toBe(false)
    expect(renderAnswer('For a 14-day mission {{r1.best_sites}} is best.', book, []).ok).toBe(false)
  })
})

