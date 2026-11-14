import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The Sightline screen's Planner (Find and Compare) and the detailed planner are styled by
 * different files that can both be on the page at once, and both name their classes `pl-…`. A
 * name in both would let one planner restyle the other, so no name may be shared.
 */
const classNames = (path: string) => new Set(readFileSync(new URL(path, import.meta.url), 'utf8').match(/\.pl-[a-z0-9-]+/g) ?? [])

describe("the two planners' styles", () => {
  it('share no class name', () => {
    const mine = classNames('./planner.css')
    const theirs = ['../planner/planner.css', '../planner/planner-brief.css', './newPlanner.css'].flatMap((path) => [...classNames(path)])
    expect(mine.size).toBeGreaterThan(20)
    expect(theirs.length).toBeGreaterThan(20)
    expect([...new Set(theirs)].filter((name) => mine.has(name))).toEqual([])
  })
})
