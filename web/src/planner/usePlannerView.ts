import { useMemo } from 'react'
import type { Alternative } from '../lib/slip'
import { alternativesAt } from '../lib/slip'
import { type PlannerAddress, writeAddress } from './address'
import { isoAt, type Landing, landingAt, type MonthAnswer, monthAnswer, type SlipCheck, slipCheck, viableFor } from './monthAnswer'
import { buildGrid, type OtherSite, otherSitesThatMonth, type PlannerGrid, type PlannerRow, type PlannerSite } from './plannerModel'

/**
 * What the planner has chosen. A null hour means "the best landing of that month", whatever the
 * limits become. A null month means nothing is chosen yet: the site's first month with a landing.
 */
export type Plan = Omit<PlannerAddress, 'index' | 'month'> & { month: string | null; index: number | null }

const MAX_OTHERS = 3

export interface PlannerView {
  grid: PlannerGrid
  row: PlannerRow
  month: string
  answer: MonthAnswer
  landing: Landing
  check: SlipCheck
  /** The landing moved the full slip, and other sites where a landing then works; null past the data. */
  late: { t: string; works: boolean; others: Alternative[] } | null
  /** Other sites with a landing this month, nearest first. */
  others: OtherSite[]
  /** Landing hours that work at the chosen site, for every hour of the data. */
  viable: Uint8Array
  /** The link that reopens exactly this. */
  hash: string
  /** True when the link named a place or month the Planner doesn't have, and it shows another. */
  substituted: boolean
}

/**
 * Everything on screen, worked out from the choice and the data by the app's own functions. Each
 * step is kept until its inputs change, so dragging a limit only redoes what depends on it.
 */
export function usePlannerView(sites: PlannerSite[] | null, plan: Plan, fallback: PlannerAddress, slipDays: number): PlannerView | null {
  const { requirements } = plan
  const grid = useMemo(() => (sites ? buildGrid(sites, requirements) : null), [sites, requirements])
  const row = grid ? (grid.rows.find((r) => r.site.id === plan.site) ?? grid.rows.find((r) => r.site.id === fallback.site) ?? grid.rows[0]) : null
  const firstWithLanding = row?.cells.find((cell) => cell.days > 0)?.month
  const wanted = plan.month ?? firstWithLanding ?? fallback.month
  const column = grid ? [wanted, fallback.month].map((m) => grid.months.indexOf(m)).find((i) => i >= 0) ?? 0 : 0

  const viable = useMemo(() => (row ? viableFor(row.flags, requirements) : null), [row, requirements])
  const answer = useMemo(
    () => (row && viable ? monthAnswer(row.site, row.flags, requirements, row.spans[column], viable) : null),
    [row, viable, requirements, column],
  )
  const hour = answer ? (plan.index === null ? answer.best.hour : answer.span.from + Math.min(plan.index, answer.span.to - answer.span.from - 1)) : 0
  const landing = useMemo(() => {
    if (!row || !viable || !answer) return null
    return hour === answer.best.hour ? answer.best : landingAt(row.site, row.flags, requirements, viable, hour)
  }, [row, viable, answer, requirements, hour])
  const check = useMemo(() => (row && landing ? slipCheck(row.flags, requirements, landing, slipDays) : null), [row, landing, requirements, slipDays])
  const late = useMemo(() => {
    const lateHour = hour + slipDays * 24
    if (!row || !viable || !sites || lateHour >= viable.length) return null
    const t = isoAt(row.flags.start, lateHour)
    return { t, works: viable[lateHour] === 1, others: alternativesAt(row.site, t, sites, requirements, MAX_OTHERS) }
  }, [row, viable, sites, requirements, hour, slipDays])

  if (!grid || !row || !viable || !answer || !landing || !check) return null
  const month = grid.months[column]
  return {
    grid,
    row,
    month,
    answer,
    landing,
    check,
    late,
    others: otherSitesThatMonth(grid, row.site, month, MAX_OTHERS),
    viable,
    hash: writeAddress({ ...plan, site: row.site.id, month, index: hour - answer.span.from }),
    substituted: row.site.id !== plan.site || (plan.month !== null && month !== plan.month),
  }
}
