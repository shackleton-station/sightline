import { compareRows } from '../../src/lib/compare'
import { type GridCell, type GridMetric, gridRow, metricFlags, monthSpans } from '../../src/lib/grid'
import { landingWindows, missionEarth } from '../../src/lib/mission'
import { formatDuration } from '../../src/lib/nextChange'
import { entryAt, measureEntry, rankOptions, toIso } from '../../src/lib/shortlist'
import { nextViable } from '../../src/lib/slip'
import { type Args, countArg, limitsArg, monthArg, siteArg, timeArg, type ToolContext, ToolError } from './args'
import { daysLabel, fact, type Fact, isoAt, limitsLabel, monthWords, type ToolResult, whenLabel } from './facts'
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
  if (metric === 'landing') facts.push(fact('limits', 'Checked against', limitsLabel(requirements)))
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
  if (metric === 'landing') facts.push(fact('limits', 'Checked against', limitsLabel(requirements)))
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
    fact('window_count', 'Stretches of hours that meet the limits', String(windows.length)),
  ]
  windows.slice(0, 4).forEach((window, i) => {
    facts.push(fact(`window_${i + 1}_start`, `Stretch ${i + 1} opens`, whenLabel(isoAt(flags.start, window.from))))
    facts.push(fact(`window_${i + 1}_end`, 'Its last hour', whenLabel(isoAt(flags.start, window.to - 1))))
    facts.push(fact(`window_${i + 1}_length`, 'Its length', formatDuration(window.to - window.from)))
  })
  if (windows.length === 0) {
    const next = nextViable(flags, isoAt(flags.start, span.from), requirements)
    facts.push(fact('next_landing', 'Next hour that meets the limits', next ? whenLabel(next.t) : 'none in the data'))
  }
  return { ok: true, title: `${site.name}, ${monthWords(month)}: landing windows`, facts }
}

/** The first hour, at or after a given time, when a landing meets the limits. */
export async function nextLanding(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const iso = timeArg(args.time, flags)
  const requirements = limitsArg(ctx, args)
  const next = nextViable(flags, iso, requirements)
  const facts: Fact[] = [
    fact('site', 'Site', site.name),
    fact('from', 'Looking from', whenLabel(iso)),
    fact('limits', 'Checked against', limitsLabel(requirements)),
    fact('next_landing', 'Next hour that meets the limits', next ? whenLabel(next.t) : 'none in the data'),
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
  const facts: Fact[] = [fact('limits', 'Checked against', limitsLabel(requirements))]
  rankOptions(measured).forEach((row, i) => {
    const n = i + 1
    facts.push(fact(`option_${n}_site`, `Option ${n}`, row.site.name))
    facts.push(fact(`option_${n}_time`, 'Landing', whenLabel(toIso(row.entry.at))))
    facts.push(fact(`option_${n}_place`, 'Place on the list', `place ${row.rank}`))
    facts.push(fact(`option_${n}_why`, 'Why', row.reasons.join(' ')))
    if (row.sunGapH !== null) facts.push(fact(`option_${n}_sun_gap`, 'Longest without the Sun during the mission', formatDuration(row.sunGapH)))
    if (row.earthGapH !== null) facts.push(fact(`option_${n}_earth_gap`, 'Longest without Earth during the mission', formatDuration(row.earthGapH)))
    if (row.sunPct !== null) facts.push(fact(`option_${n}_sun`, 'Sun up during the mission', `${row.sunPct.toFixed(0)}%`))
  })
  return { ok: true, title: 'Landing options, ranked', facts }
}
