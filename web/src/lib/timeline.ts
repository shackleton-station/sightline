import type { TimeWindow } from '../data/contract'

/** Time windows when both lists overlap; each list must be sorted and non-overlapping. */
export function intersectWindows(a: TimeWindow[], b: TimeWindow[]): TimeWindow[] {
  const result: TimeWindow[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const start = Math.max(Date.parse(a[i].start), Date.parse(b[j].start))
    const endA = Date.parse(a[i].end)
    const endB = Date.parse(b[j].end)
    const end = Math.min(endA, endB)
    if (start < end) result.push({ start: toIso(start), end: toIso(end) })
    if (endA <= endB) i += 1
    else j += 1
  }
  return result
}

/** Sample index for a horizontal position (0–1) along the time range, clamped to valid samples. */
export function indexAtFraction(fraction: number, sampleCount: number): number {
  const last = sampleCount - 1
  return Math.max(0, Math.min(last, Math.round(fraction * last)))
}

/** "2027-05-14 06:00 UTC" from an ISO-8601 UTC string. */
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}
