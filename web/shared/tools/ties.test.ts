import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildActions, viewFrom } from '../../copilot/chat/actions'
import { siteData } from './data'
import { DEFAULT_LIMITS } from './defaults'
import { listWords, monthsWords, tiedWith, tieWords } from './ties'
import { runTool } from './tools'

// Runs against the pipeline's real output, as the co-pilot does.
const data = siteData(fileURLToPath(new URL('../../public/data', import.meta.url)))
const context = { data, requirements: DEFAULT_LIMITS }

async function run(tool: string, args: Record<string, unknown>) {
  const result = await runTool(tool, args, context)
  if (!result.ok) throw new Error(result.error)
  return { facts: Object.fromEntries(result.facts.map((item) => [item.key, item.value])), labels: Object.fromEntries(result.facts.map((item) => [item.key, item.label])), ties: result.ties }
}

describe('months in words', () => {
  it('says one month, a run, a list, and a run with one apart', () => {
    expect(monthsWords(['2027-09'])).toBe('September 2027')
    expect(monthsWords(['2027-09', '2027-10', '2027-11', '2027-12'])).toBe('September to December 2027')
    expect(monthsWords(['2027-03', '2027-06', '2027-09'])).toBe('March, June and September 2027')
    expect(monthsWords(['2027-05', '2027-06'])).toBe('May and June 2027')
    expect(monthsWords(['2027-06', '2027-01', '2027-02', '2027-03'])).toBe('January to March and June 2027')
  })

  it('says every month of a year as one run, and carries the year with each month when they differ', () => {
    expect(monthsWords(Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`))).toBe('January to December 2027')
    expect(monthsWords(['2027-11', '2027-12', '2028-01', '2028-02'])).toBe('November 2027 to February 2028')
    expect(monthsWords(['2027-05', '2028-05'])).toBe('May 2027 and May 2028')
  })
})

describe('what counts as tied', () => {
  const months = [
    { month: '2027-03', printed: '100%' },
    { month: '2027-04', printed: '87%' },
    { month: '2027-06', printed: '100%' },
    { month: '2027-09', printed: '100%' },
  ]

  it('is every entry that prints the same as the best, in the order given, consecutive or not', () => {
    const tied = tiedWith(months, months[2], (entry) => entry.printed)
    expect(tied.map((entry) => entry.month)).toEqual(['2027-03', '2027-06', '2027-09'])
    expect(monthsWords(tied.map((entry) => entry.month))).toBe('March, June and September 2027')
  })

  it('is said in words: one alone, some, or all', () => {
    expect(tieWords(1, 12, 'month', 'months', 'best')).toBe('no tie: one month is best')
    expect(tieWords(4, 12, 'month', 'months', 'best')).toBe('4 months are tied for best')
    expect(tieWords(12, 12, 'month', 'months', 'best')).toBe('all 12 months are tied')
    expect(listWords(['Apollo 11', 'Apollo 17', 'Chandrayaan-3'])).toBe('Apollo 11, Apollo 17 and Chandrayaan-3')
  })
})

describe('best_months', () => {
  it('names one month when one is best', async () => {
    // Apollo 11, 2027, the Sun: February prints 53%, and no other month does.
    const { facts, labels, ties } = await run('best_months', { site: 'apollo-11', measure: 'sun', year: 2027 })
    expect(facts.best_months).toBe('February 2027')
    expect(facts.best_value).toBe('53%')
    expect(facts.best_tie).toBe('no tie: one month is best')
    expect(facts.best_1_month).toBe('February 2027')
    expect(labels.best_1_month).toBe('Best month, place 1')
    expect(ties).toBeUndefined()
  })

  it('names tied months that are not next to each other', async () => {
    // Shackleton Rim, 2027, the Sun and Earth together: July and December both print 50%.
    const { facts, ties } = await run('best_months', { site: 'shackleton-rim', measure: 'both', year: 2027 })
    expect(facts.best_months).toBe('July and December 2027')
    expect(facts.best_value).toBe('50%')
    expect(facts.best_tie).toBe('2 months are tied for best')
    expect(ties).toEqual([{ kind: 'months', site: 'shackleton-rim', months: ['2027-07', '2027-12'] }])
  })

  it("names every month of a run that is tied: Ravi's question, the sunniest month of 2027 at Shackleton Rim", async () => {
    const { facts, labels, ties } = await run('best_months', { site: 'shackleton-rim', measure: 'sun', year: 2027 })
    expect(facts.best_months).toBe('September to December 2027')
    expect(facts.best_value).toBe('100%')
    expect(facts.best_tie).toBe('4 months are tied for best')
    // The places still list months, each marked as one of the tied, so none reads as the winner.
    expect(labels.best_1_month).toMatch(/one of the months tied for best/)
    expect(facts.best_1_value).toBe('100%')
    expect(ties).toEqual([{ kind: 'months', site: 'shackleton-rim', months: ['2027-09', '2027-10', '2027-11', '2027-12'] }])
    // The worst is one month there, so nothing is said of a tie for worst.
    expect(facts.worst_month).toBe('May 2027')
    expect(facts.worst_months).toBeUndefined()
  })

  it('says so when every month is tied', async () => {
    // Apollo 11 is on the near side: Earth is in view all of every month.
    const { facts, ties } = await run('best_months', { site: 'apollo-11', measure: 'earth', year: 2027 })
    expect(facts.best_months).toBe('January to December 2027')
    expect(facts.best_value).toBe('100%')
    expect(facts.best_tie).toBe('all 12 months are tied')
    expect(ties?.[0]).toMatchObject({ kind: 'months', site: 'apollo-11' })
    expect(ties?.[0].kind === 'months' ? ties[0].months.length : 0).toBe(12)
  })
})

describe('best_sites', () => {
  it('names every site tied for best, in the order the sites are listed', async () => {
    // Earth in view in July 2027: every near-side site has it all month.
    const { facts, ties } = await run('best_sites', { month: '2027-07', measure: 'earth' })
    const tied = ties?.[0]
    if (tied?.kind !== 'sites') throw new Error('no tie among sites')
    const names = (await data.sites()).filter((site) => tied.sites.includes(site.id)).map((site) => site.name)
    expect(tied.sites.length).toBeGreaterThan(1)
    expect(facts.best_sites).toBe(listWords(names))
    expect(facts.best_value).toBe('100%')
    expect(facts.best_tie).toBe(`${tied.sites.length} sites are tied for best`)
    expect(facts.place_1_value).toBe('100%')
  })

  it('names two sites tied for best, and one site when one is best', async () => {
    const both = await run('best_sites', { month: '2027-07', measure: 'both' })
    expect(both.facts.best_sites).toBe('Connecting Ridge and de Gerlache Rim')
    expect(both.facts.best_tie).toBe('2 sites are tied for best')
    const sun = await run('best_sites', { month: '2027-07', measure: 'sun' })
    expect(sun.facts.best_sites).toBe('Connecting Ridge')
    expect(sun.facts.best_tie).toBe('no tie: one site is best')
    expect(sun.labels.place_1_site).toBe('Place 1')
    expect(sun.ties).toBeUndefined()
  })
})

describe('the buttons under an answer about a tie', () => {
  const VIEW = viewFrom('a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1')
  const build = async (raw: unknown, ties: Parameters<typeof buildActions>[4]) => buildActions(raw, VIEW, await data.sites(), await data.flags('connecting-ridge'), ties)
  const months = [{ kind: 'months' as const, site: 'shackleton-rim', months: ['2027-09', '2027-10', '2027-11', '2027-12'] }]

  it('offer the first tied month and say there are others, whichever of them the model asked for', async () => {
    const actions = await build([{ type: 'open', site: 'shackleton-rim', month: '2027-11' }], months)
    expect(actions).toHaveLength(1)
    expect(actions[0].label).toBe('Open Shackleton Rim, September 2027 (first of 4 tied months)')
    expect(actions[0].hash).toContain('shackleton-rim@2027-09')
  })

  it('keep one button when the model asked for several of the tied months', async () => {
    const actions = await build(
      [
        { type: 'open', site: 'shackleton-rim', month: '2027-09' },
        { type: 'open', site: 'shackleton-rim', month: '2027-10' },
        { type: 'open', site: 'shackleton-rim', month: '2027-12' },
      ],
      months,
    )
    expect(actions.map((action) => action.label)).toEqual(['Open Shackleton Rim, September 2027 (first of 4 tied months)'])
  })

  it('leave a button for another month, or another site, as it was', async () => {
    const actions = await build(
      [
        { type: 'open', site: 'shackleton-rim', month: '2027-05' },
        { type: 'open', site: 'connecting-ridge', month: '2027-09' },
      ],
      months,
    )
    expect(actions.map((action) => action.label)).toEqual(['Open Shackleton Rim, May 2027', 'Open Connecting Ridge, September 2027'])
  })

  it('offer the first of several tied sites', async () => {
    const actions = await build([{ type: 'open', site: 'apollo-17', month: '2027-07' }], [{ kind: 'sites', month: '2027-07', sites: ['apollo-11', 'apollo-17'] }])
    expect(actions[0].label).toBe('Open Apollo 11, July 2027 (first of 2 tied sites)')
    expect(actions[0].hash).toContain('apollo-11@2027-07')
  })

  it('with no tie, are as they always were', async () => {
    const actions = await build([{ type: 'open', site: 'shackleton-rim', month: '2027-11' }], [])
    expect(actions[0].label).toBe('Open Shackleton Rim, November 2027')
  })
})
