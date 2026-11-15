import { monthWords } from './facts'

/**
 * Ties among the entries a tool ranks. Where one winner is picked from a list (the best month at a
 * site, the best site in a month), every entry equal to the best at the precision the screen shows
 * (whole percent for a share, whole days for landing days) is a winner too: the tool names them all,
 * and Scout says they are tied instead of naming the first.
 */

/** What a tool found tied for best, so the buttons under the answer can offer the first and say there are others. */
export type Tie =
  | { kind: 'months'; site: string; months: string[] }
  | { kind: 'sites'; month: string; sites: string[] }

/** "a", "a and b", "a, b and c". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The entries equal to `best` as the screen prints them, in the order given. */
export function tiedWith<T>(entries: T[], best: T, printed: (entry: T) => string): T[] {
  const value = printed(best)
  return entries.filter((entry) => printed(entry) === value)
}

const monthNumber = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
const nameOnly = (month: string) => monthWords(month).split(' ')[0]

/**
 * Months ("2027-09", ...) in words, in calendar order: a run of three or more as "September to
 * December 2027", others listed ("March, June and September 2027"). The year is said once when they
 * share it, and with each month when they do not ("November 2027 to February 2028").
 */
export function monthsWords(months: string[]): string {
  const sorted = [...new Set(months)].sort()
  if (sorted.length === 0) return ''
  const runs: string[][] = []
  for (const month of sorted) {
    const run = runs[runs.length - 1]
    if (run && monthNumber(month) === monthNumber(run[run.length - 1]) + 1) run.push(month)
    else runs.push([month])
  }
  const oneYear = sorted.every((month) => month.slice(0, 4) === sorted[0].slice(0, 4))
  const say = oneYear ? nameOnly : monthWords
  const parts = runs.flatMap((run) => (run.length >= 3 ? [`${say(run[0])} to ${say(run[run.length - 1])}`] : run.map(say)))
  return oneYear ? `${listWords(parts)} ${sorted[0].slice(0, 4)}` : listWords(parts)
}

/** Whether the best (or worst) is a tie, in words: how many share it, or that one stands alone. */
export function tieWords(tied: number, all: number, one: string, many: string, place: 'best' | 'worst'): string {
  if (tied <= 1) return `no tie: one ${one} is ${place}`
  if (tied === all) return `all ${all} ${many} are tied`
  return `${tied} ${many} are tied for ${place}`
}
