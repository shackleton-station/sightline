import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import type { OverviewYear } from '../../src/data/contract'
import { hourOf, locateHour, NO_GAP_LIMIT_H } from '../../src/lib/mission'
import { firstSentence, ringedSites, sitesNamedIn } from '../../src/lib/scoutRing'
import { stateAt } from '../../src/lib/sightline'
import { betterDate, type SightlineMission, steadierLanding } from '../../src/lib/sightlineMission'
import type { Bucket } from '../../shared/bucket'
import { siteData } from '../../shared/tools/data'
import { distanceWords, isoAt, limitFacts, whenLabel } from '../../shared/tools/facts'
import { runTool } from '../../shared/tools/tools'
import type { Model } from '../model'
import { claudeMessage, toolUse } from '../standIns'
import { asksToChangeLimits, buildActions, viewFrom } from './actions'
import { runChat, viewFacts } from './chat'
import { systemPrompt } from './prompt'
import { scenarioScene } from './scenarios'

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

/** The next landing the screen's column offers: the first hour that fits, moved on to where half the Sun's disc shows. */
async function columnNext(site: string, iso: string): Promise<string | null> {
  const flags = await data.flags(site)
  const first = betterDate(flags, hourOf(flags.start, iso), MISSION)
  if (!first) return null
  const at = locateHour(flags.start, first.landing)
  const shares = (await data.scenario(site, at.month)).track.map((point) => point.sun_frac)
  return whenLabel(isoAt(flags.start, steadierLanding(flags, first.landing, MISSION, shares, first.landing - at.index)))
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
const ask = (model: Model, hash: string, text: string, from = data) => runChat({ turns: [{ role: 'user', text }], view: viewFrom(hash), viewHash: hash }, { model, data: from, wait: async () => {} })

describe('1. a solar panel at 10 m', () => {
  it('gives Scout the heights as facts he can cite, and the scenario\'s figures at them: 72 h of darkness, next landing 25 May 12:00', async () => {
    const scene = await scenarioScene(TEN_M, viewFrom(TEN_M), high)
    const value = (key: string) => scene?.facts.find((item) => item.key === key)?.value
    expect(value('panel_height')).toBe('10 m')
    expect(value('antenna_height')).toBe('2 m')
    expect(value('scenario_a_longest_time_without_sun')).toBe('72 h')
    expect(value('scenario_a_next_landing')).toBe('25 May 2027, 12:00 UTC')
    // At 2 m the same scenario reads 95 h and 21 June: the heights change the answer, as on the screen.
    const low = await scenarioScene(TEN_M.replace('&hp=10', ''), viewFrom(TEN_M), data)
    expect(low?.facts.find((item) => item.key === 'scenario_a_longest_time_without_sun')?.value).toBe('95 h')
    expect(low?.facts.find((item) => item.key === 'scenario_a_next_landing')?.value).toBe('21 June 2027, 17:00 UTC')
  })

  it('answers the question from those facts, with no number typed by the model', async () => {
    const model = scripted([answer('With the solar panel at {{r0.panel_height}}, the longest time without the Sun during this mission is {{r0.scenario_a_longest_time_without_sun}}. The next landing that fits is {{r0.scenario_a_next_landing}}.')])
    const outcome = await ask(model, TEN_M, 'My solar panel is 10 m above the ground. How long is the longest dark spell during my mission now?', high)
    expect(outcome.ok && outcome.reply.text).toBe('With the solar panel at 10 m, the longest time without the Sun during this mission is 72 h. The next landing that fits is 25 May 2027, 12:00 UTC.')
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

  it('is still 21 June 17:00 at Connecting Ridge from 6 May 2027', async () => {
    const next = (await facts('next_landing', { site: 'connecting-ridge', time: '2027-05-06T13' })).values
    expect(next.next_landing).toBe('21 June 2027, 17:00 UTC')
    expect(next.wait).toBe('46 d 4 h')
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
    expect(value('scenario_a_reason_1')).toBe('the Sun is gone for 95 h during the mission; your limit is 24 h')
    expect(value('scenario_b_reason_1')).toBe('the Sun is gone for 79 h during the mission; your limit is 24 h')
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

  it('is asked for in the instructions: the full list once, in a sentence of its own', () => {
    const rules = systemPrompt({ first_year: 2026, last_year: 2049 })
    expect(rules).toMatch(/Give the full list \(the limits fact\) at most once, as a sentence of its own/)
    expect(rules).toMatch(/To name one limit, cite its own fact: mission_length, dark_limit or silence_limit/)
  })
})

describe('6. a custom point', () => {
  it('says how far the nearest listed site is in meters under a kilometer, and that the screen\'s column is for the exact point', async () => {
    expect(distanceWords(0.223)).toBe('220 m')
    expect(distanceWords(2.44)).toBe('2.4 km')
    expect(distanceWords(42.3)).toBe('42 km')
    const view = Object.fromEntries((await viewFacts(viewFrom('#a=-89.46,-137.2@2027-05&t=100&limits=14_72_72_1_1&mode=plan'), data)).map((item) => [item.key, item.value]))
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
    expect(why.ok && why.reply.text).toBe('It fails because the Sun is gone for 95 h during the mission; your limit is 24 h.')
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
    expect(scene?.facts.find((item) => item.key === 'scenario_a_no_other_site_fits')?.value).toBe('none of the other sites in its group fits on this date')
    // The exact fragment that reached a visitor ("On the date of scenario A, none: on this date no other site of the group meets them.").
    for (const item of scene?.facts ?? []) {
      expect(item.value, item.key).not.toMatch(/none: on this date/)
      expect(item.value, item.key).not.toMatch(/^none:/)
    }
  })

  it('reads as a sentence when Scout uses it', async () => {
    const outcome = await ask(scripted([answer('The next landing at Apollo 11 that fits is {{r0.scenario_a_next_landing}}, and {{r0.scenario_a_no_other_site_fits}}.')]), APOLLO, 'When is the next landing here that fits?')
    expect(outcome.ok && outcome.reply.text).toBe('The next landing at Apollo 11 that fits is 11 May 2027, 13:00 UTC, and none of the other sites in its group fits on this date.')
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
    expect(value('scenario_on_screen')).toBe('A: Connecting Ridge, landing 6 May 2027, 13:00 UTC')
    expect(value('panel_height')).toBe('10 m')
    expect(value('scenario_a_longest_time_without_sun')).toBe('72 h')
    expect(value('scenario_a_next_landing')).toBe('25 May 2027, 12:00 UTC')
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

  it('says so in the instructions: never "the site on your screen", and "now" is the hour on the time bar', () => {
    const rules = systemPrompt({ first_year: 2026, last_year: 2049 })
    expect(rules).toMatch(/If r0 has no_site_chosen.*Never say "the site on your screen"/)
    expect(rules).toMatch(/"Now" and "right now" mean the hour on the visitor's time bar/)
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

  it('with no time given, is for the hour on the visitor\'s time bar, and says so', async () => {
    const result = await runTool('sites_in_view', {}, { ...context, hourIso: '2026-12-10T00:00:00Z' })
    if (!result.ok) throw new Error(result.error)
    const time = result.facts.find((item) => item.key === 'time')
    expect(time?.value).toBe('10 December 2026, 00:00 UTC')
    expect(time?.label).toMatch(/the hour on the visitor's time bar/)
  })

  it('answers with the list for that hour, and the sites the Moon rings are the ones the first sentence names', async () => {
    const model = scripted([{ name: 'sites_in_view', args: {} }], [answer('At the hour on the time bar, {{r0.time}}, Earth is in view {{r1.earth_in_view}}. That is {{r1.earth_in_view_count}}.')])
    const outcome = await ask(model, WATCH, QUESTION)
    if (!outcome.ok) throw new Error('no answer')
    const text = outcome.reply.text
    expect(text).toMatch(/^At the hour on the time bar, 10 December 2026, 00:00 UTC, Earth is in view /)
    expect(text).not.toMatch(/the site on your screen/)
    expect(text).not.toMatch(/should see/)
    // What Scout was sent says no site is chosen, and names none as the screen's.
    const sent = String(model.generate.mock.calls[0][0].messages[0].content)
    expect(sent).toMatch(/- no_site_chosen: /)
    expect(sent).not.toMatch(/^- site: /m)
    // The Moon rings the sites the first sentence names: exactly the sites with Earth in view at that hour.
    const all = await data.allFlags()
    const sites = all.map(({ site }) => site)
    const hour = hourOf(all[0].flags.start, '2026-12-10T00:00:00Z')
    const withEarth = all.filter(({ flags }) => ['both', 'earth'].includes(stateAt(flags, hour))).map(({ site }) => site.id).sort()
    const ringed = ringedSites(outcome.reply, sites, () => null)
    expect([...ringed].sort()).toEqual(withEarth)
    expect([...ringed].sort()).toEqual(sitesNamedIn(firstSentence(text), sites).sort())
    expect(withEarth.length).toBeGreaterThan(1)
    // Connecting Ridge has Earth out of view at that hour: it is not ringed, and not named first.
    expect(ringed).not.toContain('connecting-ridge')
  })
})

