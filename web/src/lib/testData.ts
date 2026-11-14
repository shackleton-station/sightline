/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Overview, OverviewYear, YearSummary } from '../data/contract'
import { joinOverviews, joinYears } from './span'

/**
 * For tests only: the pipeline's real files, read from disk. The tests that work on real data keep
 * to the four years every check was first measured on (the pipeline's `CHECK_YEARS`), so their
 * numbers stay put as the range grows.
 */
export const CHECK_YEARS = [2027, 2028, 2029, 2030]

export const dataFile = <T,>(name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), 'utf8')) as T

/** Every site's flags over the check years, as one overview. */
export function checkOverview(): Overview {
  return joinOverviews(CHECK_YEARS.map((year) => dataFile<OverviewYear>(`overview/${year}.json`)))
}

/** A site's monthly and yearly numbers over the check years. */
export function checkYears(siteId: string): YearSummary {
  return joinYears(CHECK_YEARS.map((year) => dataFile<YearSummary>(`${siteId}/year-${year}.json`)))
}
