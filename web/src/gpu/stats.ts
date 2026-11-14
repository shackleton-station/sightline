/** The latest measurements of one thing, at most `size` of them, and what is typical of them. */
export class Recent {
  private readonly values: number[] = []
  private readonly size: number

  constructor(size = 300) {
    this.size = size
  }

  add(value: number): void {
    this.values.push(value)
    if (this.values.length > this.size) this.values.shift()
  }

  clear(): void {
    this.values.length = 0
  }

  /** The middle value and the one 95% of them are at or under; null with nothing measured. */
  summary(): Summary | null {
    if (this.values.length === 0) return null
    const sorted = [...this.values].sort((a, b) => a - b)
    return { n: sorted.length, median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
  }
}

export interface Summary {
  n: number
  median: number
  p95: number
}

/** The value a share of a sorted list is at or under (nearest rank). */
export function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))]
}
