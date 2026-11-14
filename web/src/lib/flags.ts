/** Hourly up or down for the Sun and Earth at a site, from ``start``. */
export interface SiteFlags {
  start: string
  sun: boolean[]
  /** Any part of Earth's disk above the terrain. */
  earth: boolean[]
  /** Earth's center at least this many degrees above the terrain, keyed by degrees. */
  earthAbove: Record<string, boolean[]>
}

/** Hourly flags from runs of ``[from, to, from, to, ...]``, with ``to`` exclusive. */
export function decodeRuns(runs: number[], hours: number): boolean[] {
  const flags = new Array<boolean>(hours).fill(false)
  for (let i = 0; i + 1 < runs.length; i += 2) flags.fill(true, runs[i], runs[i + 1])
  return flags
}
