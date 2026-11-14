/** Format a fraction (0–1) as a whole-number percentage, e.g. 0.734 → "73%". */
export function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
