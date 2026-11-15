import { compareRows } from '../../src/lib/compare'
import { type GridCell, type GridMetric, gridRow, metricFlags, monthSpans } from '../../src/lib/grid'
import { landingWindows, longestDown, missionEarth } from '../../src/lib/mission'
import { formatDuration } from '../../src/lib/nextChange'
import { wholePct } from '../../src/lib/verdict'
import { entryAt, measureEntry, rankOptions, toIso } from '../../src/lib/shortlist'
import { type Args, countArg, limitsArg, monthArg, siteArg, timeArg, type ToolContext, ToolError } from './args'
import { daysLabel, fact, type Fact, isoAt, limitsLabel, monthWords, reasonClause, type ToolResult, whenLabel } from './facts'
import { limitsChanged } from './limitsTried'
import { nextLandingOnScreen } from './nextLanding'
import { listWords, monthsWords, tiedWith, tieWords } from './ties'

const METRICS: Record<GridMetric, string> = {
  landing: 'days with an hour that meets the limits',
  both: 'time with the Sun and Earth both up',
  sun: 'time with the Sun up',
  earth: 'time with Earth in view',
}

function metricArg(value: unknown): GridMetric {
  if (typeof value === 'string' && value in METRICS) return value as GridMetric
  throw new ToolError(`Unknown measure. Use one of: ${Object.keys(METRICS).join(', ')}.`)
}

const cellValue = (metric: GridMetric, cell: GridCell) => (metric === 'landing' ? daysLabel(cell.days) : `${cell.text}%`)

/** What the screen prints for a cell: two cells that print the same are tied (whole percent for a share, whole days for landing days). */
const printed = (metric: GridMetric) => (cell: GridCell) => cellValue(metric, cell)

/** The months that do best, and the one that does worst, at one site. */
export async function bestMonths(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const metric = metricArg(args.measure)
  const requirements = limitsArg(ctx, args)
  const year = typeof args.year === 'number' ? String(Math.round(args.year)) : null

  const spans = monthSpans(flags.start, flags.sun.length).filter((span) => !year || span.month.startsWith(year))
  if (spans.length === 0) throw new ToolError('No data for that year.')
  const cells = gridRow(metricFlags(metric, flags, requirements), spans, metric)
  const ranked = [...cells].sort((a, b) => b.share - a.share)
  const top = ranked.slice(0, countArg(args.count, 3, 1, 6))
  const worst = ranked[ranked.length - 1]
  // Every month that prints the same as the best is a best month too, in calendar order; the same for the worst.
  const best = tiedWith(cells, ranked[0], printed(metric))
  const worstTied = tiedWith(cells, worst, printed(metric))
  const tie = best.length > 1

  const facts: Fact[] = [fact('site', 'Site', site.name), fact('measure', 'Measured by', METRICS[metric])]
  if (metric === 'landing') facts.push(fact('limits', 'Checked against', limitsLabel(requirements)), ...limitsChanged(ctx.requirements, requirements))
  facts.push(fact('best_months', tie ? 'The months tied for best: equal at the precision shown, so name them together and never one of them alone' : 'The best month', monthsWords(best.map((cell) => cell.month))))
  facts.push(fact('best_value', tie ? 'The value they share' : 'Its value', cellValue(metric, best[0])))
  facts.push(fact('best_tie', 'Whether the best is a tie', tieWords(best.length, cells.length, 'month', 'months', 'best')))
  top.forEach((cell, i) => {
    const shared = tie && best.includes(cell) ? ' (one of the months tied for best: see best_months)' : ''
    facts.push(fact(`best_${i + 1}_month`, `Best month, place ${i + 1}${shared}`, monthWords(cell.month)))
    facts.push(fact(`best_${i + 1}_value`, 'Its value', cellValue(metric, cell)))
  })
  facts.push(fact('worst_month', worstTied.length > 1 ? 'Worst month (one of several tied for worst: see worst_months)' : 'Worst month', monthWords(worst.month)))
  facts.push(fact('worst_value', 'Its value', cellValue(metric, worst)))
  if (worstTied.length > 1 && worstTied.length < cells.length) {
    facts.push(fact('worst_months', 'The months tied for worst: equal at the precision shown, so name them together', monthsWords(worstTied.map((cell) => cell.month))))
    facts.push(fact('worst_tie', 'Whether the worst is a tie', tieWords(worstTied.length, cells.length, 'month', 'months', 'worst')))
  }
  return {
    ok: true,
    title: `${site.name}: best months${year ? ` of ${year}` : ''}`,
    facts,
    ...(tie ? { ties: [{ kind: 'months' as const, site: site.id, months: best.map((cell) => cell.month) }] } : {}),
  }
}

/** The listed sites that do best in one month. */
export async function bestSites(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const all = await ctx.data.allFlags()
  const month = monthArg(args.month, all[0].flags)
  const metric = metricArg(args.measure)
  const requirements = limitsArg(ctx, args)

  const rows = all.map(({ site, flags }) => {
    const spans = monthSpans(flags.start, flags.sun.length).filter((span) => span.month === month)
    return { site, cell: gridRow(metricFlags(metric, flags, requirements), spans, metric)[0] }
  })
  // Every site that prints the same as the best is a best site too, in the order the sites are listed.
  const leader = rows.reduce((top, row) => (row.cell.share > top.cell.share ? row : top))
  const best = tiedWith(rows, leader, (row) => cellValue(metric, row.cell))
  const tie = best.length > 1
  rows.sort((a, b) => b.cell.share - a.cell.share)

  const facts: Fact[] = [
    fact('month', 'Month', monthWords(month)),
    fact('measure', 'Measured by', METRICS[metric]),
    fact('sites_checked', 'Listed sites checked', String(rows.length)),
  ]
  if (metric === 'landing') facts.push(fact('limits', 'Checked against', limitsLabel(requirements)), ...limitsChanged(ctx.requirements, requirements))
  facts.push(fact('best_sites', tie ? 'The sites tied for best: equal at the precision shown, so name them together and never one of them alone' : 'The best site', listWords(best.map((row) => row.site.name))))
  facts.push(fact('best_value', tie ? 'The value they share' : 'Its value', cellValue(metric, best[0].cell)))
  facts.push(fact('best_tie', 'Whether the best is a tie', tieWords(best.length, rows.length, 'site', 'sites', 'best')))
  rows.slice(0, countArg(args.count, 5, 1, 8)).forEach((row, i) => {
    const shared = tie && best.includes(row) ? ' (one of the sites tied for best: see best_sites)' : ''
    facts.push(fact(`place_${i + 1}_site`, `Place ${i + 1}${shared}`, row.site.name))
    facts.push(fact(`place_${i + 1}_value`, 'Its value', cellValue(metric, row.cell)))
  })
  return {
    ok: true,
    title: `All listed sites, ${monthWords(month)}: ranking`,
    facts,
    ...(tie ? { ties: [{ kind: 'sites' as const, month, sites: best.map((row) => row.site.id) }] } : {}),
  }
}

/** The groups the listed sites come in, as a question names them, and the words for each in a sentence. */
const GROUPS: Record<string, { group: string; words: string }> = {
  south_pole: { group: 'South pole ridges', words: 'the south pole ridge sites' },
  apollo: { group: 'Apollo', words: 'the Apollo sites' },
  clps: { group: 'CLPS', words: 'the CLPS sites' },
  other_countries: { group: 'Other countries', words: "other countries' sites" },
}

/**
 * The listed sites (all of them, or one group) ranked over one calendar year, each with its own best
 * month: one result for "which site is best in 2027, and when". Landing days are the days of the year
 * with an hour that meets the limits; a share is the share of the year's hours. Sites that print the
 * same are tied, as in a month's ranking.
 */
export async function bestSitesInYear(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const everySite = await ctx.data.allFlags()
  const metric = metricArg(args.measure)
  const requirements = limitsArg(ctx, args)
  const year = typeof args.year === 'number' ? String(Math.round(args.year)) : ''
  const asked = typeof args.group === 'string' ? GROUPS[args.group] : undefined
  if (typeof args.group === 'string' && !asked) throw new ToolError(`Unknown group. Use one of: ${Object.keys(GROUPS).join(', ')}.`)
  const all = asked ? everySite.filter(({ site }) => site.group === asked.group) : everySite
  if (all.length === 0) throw new ToolError('No listed site is in that group.')

  const rows = all.map(({ site, flags }) => {
    const spans = monthSpans(flags.start, flags.sun.length).filter((span) => span.month.startsWith(`${year}-`))
    if (spans.length === 0) throw new ToolError('No data for that year.')
    const counted = metricFlags(metric, flags, requirements)
    const cells = gridRow(counted, spans, metric)
    const hours = spans.reduce((sum, span) => sum + (span.to - span.from), 0)
    const days = cells.reduce((sum, cell) => sum + cell.days, 0)
    const up = cells.reduce((sum, cell) => sum + cell.hours, 0)
    const bestMonth = cells.reduce((top, cell) => (cell.share > top.share ? cell : top))
    const tiedMonths = tiedWith(cells, bestMonth, printed(metric))
    // Why a site does well or badly, whatever it is ranked by: how much of the year the Sun and Earth
    // are in view there, and the longest stretch of the year without the Sun.
    const [from, to] = [spans[0].from, spans[spans.length - 1].to]
    const earth = missionEarth(flags, requirements)
    const share = (series: boolean[]) => {
      let seen = 0
      for (let hour = from; hour < to; hour += 1) if (series[hour]) seen += 1
      // As the screen writes a year's share: the pipeline's figure to one decimal, then to the whole percent.
      return wholePct(Math.round((1000 * seen) / (to - from)) / 10)
    }
    return {
      site,
      days,
      pct: Math.round((100 * up) / hours),
      sun: share(flags.sun),
      earth: share(earth),
      dark: formatDuration(longestDown(flags.sun, from, to)),
      score: metric === 'landing' ? days / (hours / 24) : up / hours,
      value: metric === 'landing' ? `${days} of ${daysLabel(hours / 24)}` : `${Math.round((100 * up) / hours)}% of the year`,
      // "December 2027, with 20 days on which a landing fits"; for a share, "with 97%".
      best: `${tiedMonths.length > 1 ? `${monthsWords(tiedMonths.map((cell) => cell.month))}, each` : `${monthWords(bestMonth.month)},`} with ${cellValue(metric, bestMonth)}${metric === 'landing' ? ' on which a landing fits' : ''}`,
    }
  })
  const leader = rows.reduce((top, row) => (row.score > top.score ? row : top))
  const best = tiedWith(rows, leader, (row) => row.value)
  const tie = best.length > 1
  rows.sort((a, b) => b.score - a.score)

  const facts: Fact[] = [
    fact('year', 'Year', year),
    fact('sites_ranked', 'The sites ranked', asked ? `${asked.words} (${rows.length})` : `all ${rows.length} listed sites`),
    fact('measure', 'Measured by', metric === 'landing' ? 'days of the year with an hour that meets the limits' : METRICS[metric]),
  ]
  if (metric === 'landing') facts.push(fact('limits', 'Checked against', limitsLabel(requirements)), ...limitsChanged(ctx.requirements, requirements))
  facts.push(fact('best_sites', tie ? 'The sites tied for best over the year: equal at the precision shown, so name them together and never one of them alone' : 'The best site over the year', listWords(best.map((row) => row.site.name))))
  facts.push(fact('best_value', tie ? 'The value they share' : 'Its value', best[0].value))
  facts.push(fact('best_tie', 'Whether the best is a tie', tieWords(best.length, rows.length, 'site', 'sites', 'best')))
  // How close the runner-up is, as a clause: the first site that is not among the best.
  const next = rows.find((row) => !best.includes(row))
  if (next) {
    const behind = metric === 'landing' ? daysLabel(leader.days - next.days) : `${leader.pct - next.pct} ${leader.pct - next.pct === 1 ? 'percentage point' : 'percentage points'}`
    facts.push(fact('runner_up_site', 'The runner-up: the best site that is not among the best', next.site.name))
    facts.push(fact('runner_up_gap', 'How far behind the best the runner-up is, as it sits in a sentence ("{{…runner_up_site}} is {{…runner_up_gap}}")', `${behind} behind`))
  }
  rows.slice(0, countArg(args.count, 4, 1, 8)).forEach((row, i) => {
    const shared = tie && best.includes(row) ? ' (one of the sites tied for best: see best_sites)' : ''
    facts.push(fact(`place_${i + 1}_site`, `Place ${i + 1}${shared}`, row.site.name))
    facts.push(fact(`place_${i + 1}_value`, 'Its value over the year', row.value))
    facts.push(fact(`place_${i + 1}_best_month`, 'Its own best month of that year (when to go there)', row.best))
    // The why behind a place: cite the one that separates two sites.
    facts.push(fact(`place_${i + 1}_sun_share`, 'Share of that year with the Sun in view there', row.sun))
    facts.push(fact(`place_${i + 1}_longest_dark`, 'Its longest stretch without the Sun that year', row.dark))
    facts.push(fact(`place_${i + 1}_earth_share`, 'Share of that year with Earth in view there', row.earth))
  })
  return { ok: true, title: `${asked ? asked.group : 'All listed sites'}, ${year}: ranking over the year`, facts }
}

/** When, in one month, a landing meets the limits. */
export async function landingWindowsInMonth(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const month = monthArg(args.month, flags)
  const requirements = limitsArg(ctx, args)
  const span = monthSpans(flags.start, flags.sun.length).find((candidate) => candidate.month === month)
  if (!span) throw new ToolError(`No data for ${month}.`)

  const windows = landingWindows(flags.sun, missionEarth(flags, requirements), requirements).filter(
    (window) => window.from < span.to && window.to > span.from,
  )
  const facts: Fact[] = [
    fact('site', 'Site', site.name),
    fact('month', 'Month', monthWords(month)),
    fact('limits', 'Checked against', limitsLabel(requirements)),
    ...limitsChanged(ctx.requirements, requirements),
    fact('window_count', 'How many stretches of hours meet the limits', `${windows.length} ${windows.length === 1 ? 'stretch' : 'stretches'}`),
  ]
  windows.slice(0, 4).forEach((window, i) => {
    facts.push(fact(`window_${i + 1}_start`, `Stretch ${i + 1} opens`, whenLabel(isoAt(flags.start, window.from))))
    facts.push(fact(`window_${i + 1}_end`, 'Its last hour', whenLabel(isoAt(flags.start, window.to - 1))))
    facts.push(fact(`window_${i + 1}_length`, 'Its length', formatDuration(window.to - window.from)))
  })
  if (windows.length === 0) {
    const next = await nextLandingOnScreen(ctx.data, site.id, flags, isoAt(flags.start, span.from), requirements)
    facts.push(fact('next_landing', 'Next landing that fits, as the visitor\'s screen offers it', next ? whenLabel(next.t) : 'none in the data'))
  }
  return { ok: true, title: `${site.name}, ${monthWords(month)}: landing windows`, facts }
}

/** The first hour, at or after a given time, when a landing meets the limits. */
export async function nextLanding(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const iso = timeArg(args.time, flags)
  const requirements = limitsArg(ctx, args)
  // The hour the visitor's screen offers as "Next landing that fits", by the same rule.
  const next = await nextLandingOnScreen(ctx.data, site.id, flags, iso, requirements)
  const facts: Fact[] = [
    fact('site', 'Site', site.name),
    fact('from', 'Looking from', whenLabel(iso)),
    fact('limits', 'Checked against', limitsLabel(requirements)),
    ...limitsChanged(ctx.requirements, requirements),
    fact('next_landing', 'Next landing that fits, as the visitor\'s screen offers it', next ? whenLabel(next.t) : 'none in the data'),
  ]
  if (next) facts.push(fact('wait', 'Wait until then', next.waitH === 0 ? 'none: that hour already works' : formatDuration(next.waitH)))
  return { ok: true, title: `${site.name}: next landing after ${whenLabel(iso)}`, facts }
}

/** Two listed sites, the same month, row by row, judged against the model's measured error. */
export async function compareSites(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const [a, b] = await Promise.all([siteArg(ctx, args.site_a), siteArg(ctx, args.site_b)])
  if (a.id === b.id) throw new ToolError('Pick two different sites.')
  const month = monthArg(args.month, await ctx.data.flags(a.id))
  const [dataA, dataB] = await Promise.all([ctx.data.scenario(a.id, month), ctx.data.scenario(b.id, month)])

  const better = { A: a.name, B: b.name, 'Too close': 'too close to call', Same: 'the same' }
  const facts: Fact[] = [fact('site_a', 'First site', a.name), fact('site_b', 'Second site', b.name), fact('month', 'Month', monthWords(month))]
  for (const row of compareRows(dataA, dataB)) {
    const key = row.label.toLowerCase().replace(/[^a-z]+/g, '_')
    facts.push(fact(`${key}_a`, `${row.label} at ${a.name}`, row.a))
    facts.push(fact(`${key}_b`, `${row.label} at ${b.name}`, row.b))
    facts.push(fact(`${key}_better`, `${row.label}: better`, better[row.better]))
  }
  return { ok: true, title: `${a.name} and ${b.name}, ${monthWords(month)}: comparison`, facts }
}

/**
 * Why an option stands where it does, as a clause that follows its name: "meets the limits and has
 * the shortest time without the Sun of these options", "does not meet the limits because the Sun is
 * gone for 95 h, past the 24 h limit". The screen's list shows these as short tags ("Meets your
 * limits", "Shortest time without Sun on this list"); handed to Scout as they were, a tag read in
 * an answer like a heading that had been filled in as a value.
 */
export function whyWords(reasons: string[]): string {
  const tag = /^Shortest time without (Sun|Earth) on this list$/
  const problems = reasons.filter((reason) => reason !== 'Meets your limits' && !tag.test(reason))
  const clauses = [
    ...(reasons.includes('Meets your limits') ? ['meets the limits'] : []),
    ...(problems.length > 0 ? [`does not meet the limits because ${listWords(problems.map(reasonClause))}`] : []),
    ...reasons.flatMap((reason) => {
      const body = tag.exec(reason)?.[1]
      return body ? [`has the shortest time without ${body === 'Sun' ? 'the Sun' : 'Earth'} of these options`] : []
    }),
  ]
  return listWords(clauses)
}

/** Several landing options (a site and an hour each), ranked. No blended score: limits first, then gaps. */
export async function rankLandingOptions(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const options = Array.isArray(args.options) ? args.options.slice(0, 6) : []
  if (options.length < 2) throw new ToolError('Give at least two options, each with a site and a time.')
  const requirements = limitsArg(ctx, args)

  const measured = await Promise.all(
    options.map(async (option) => {
      const { site: siteId, time } = (option ?? {}) as Args
      const site = await siteArg(ctx, siteId)
      const flags = await ctx.data.flags(site.id)
      return measureEntry({ site: site.id, at: entryAt(timeArg(time, flags)) }, site, flags, requirements)
    }),
  )
  const facts: Fact[] = [fact('limits', 'Checked against', limitsLabel(requirements)), ...limitsChanged(ctx.requirements, requirements)]
  rankOptions(measured).forEach((row, i) => {
    const n = i + 1
    facts.push(fact(`option_${n}_site`, `Option ${n}`, row.site.name))
    facts.push(fact(`option_${n}_time`, 'Landing', whenLabel(toIso(row.entry.at))))
    facts.push(fact(`option_${n}_place`, 'Place on the list', `place ${row.rank}`))
    facts.push(fact(`option_${n}_why`, 'Why it stands where it does, as a clause that follows the option\'s name ("{{…_site}} {{…_why}}")', whyWords(row.reasons)))
    if (row.sunGapH !== null) facts.push(fact(`option_${n}_sun_gap`, 'Longest without the Sun during the mission', formatDuration(row.sunGapH)))
    if (row.earthGapH !== null) facts.push(fact(`option_${n}_earth_gap`, 'Longest without Earth during the mission', formatDuration(row.earthGapH)))
    if (row.sunPct !== null) facts.push(fact(`option_${n}_sun`, 'Sun up during the mission', `${row.sunPct.toFixed(0)}%`))
  })
  return { ok: true, title: 'Landing options, ranked', facts }
}
