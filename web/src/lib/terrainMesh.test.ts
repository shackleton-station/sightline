import { describe, expect, it } from 'vitest'
import { buildSiteLevels, buildTerrainLevel } from './terrainMesh'

const flat = () => 1000

describe('terrain mesh', () => {
  it('puts the site at the origin and the grid on the sphere', () => {
    const level = buildTerrainLevel(flat, -89.5, 45, 1000, { halfM: 1000, stepM: 100 })
    expect(level.size).toBe(21)
    const center = 10 * 21 + 10
    expect(level.positions[center * 3]).toBeCloseTo(0)
    expect(level.positions[center * 3 + 1]).toBeCloseTo(0)
    expect(level.positions[center * 3 + 2]).toBeCloseTo(0)
    // Flat ground curves away: the corner drops by about d²/2R.
    const cornerZ = level.positions[2]
    const d = Math.SQRT2 * 1000
    expect(cornerZ).toBeCloseTo((-d * d) / (2 * 1_738_400), 1)
  })

  it('starts at the north row and west column', () => {
    const level = buildTerrainLevel(flat, 10, 20, 1000, { halfM: 500, stepM: 500 })
    expect(level.positions[0]).toBeLessThan(0) // west
    expect(level.positions[1]).toBeGreaterThan(0) // north
    expect(level.positions[8 * 3]).toBeGreaterThan(0) // east
    expect(level.positions[8 * 3 + 1]).toBeLessThan(0) // south
  })

  it('reads heights where the grid says it does', () => {
    // Heights rising toward the north: the north row must be the highest.
    const northward = (lat: number) => (lat - 10) * 1000
    const level = buildTerrainLevel(northward, 10, 20, 0, { halfM: 5000, stepM: 5000 })
    expect(level.heights[1]).toBeGreaterThan(level.heights[4])
    expect(level.heights[7]).toBeLessThan(level.heights[4])
  })

  it('leaves out only the triangles a finer level covers', () => {
    const whole = buildTerrainLevel(flat, 0, 0, 1000, { halfM: 1000, stepM: 100 })
    const holed = buildTerrainLevel(flat, 0, 0, 1000, { halfM: 1000, stepM: 100 }, 500)
    expect(whole.indices.length).toBe(20 * 20 * 6)
    expect(holed.indices.length).toBe((20 * 20 - 10 * 10) * 6)
  })

  it('reports the highest point of any level', () => {
    // Only the coarsest level reaches far enough north to find the high ground.
    const heights = (lat: number) => (lat > 0.5 ? 5000 : 100)
    const { maxHeightM, siteHeightM } = buildSiteLevels(heights, 0, 0, [
      { halfM: 1000, stepM: 500 },
      { halfM: 2000, stepM: 1000 },
      { halfM: 40_000, stepM: 10_000 },
    ])
    expect(siteHeightM).toBe(100)
    expect(maxHeightM).toBe(5000)
  })
})
