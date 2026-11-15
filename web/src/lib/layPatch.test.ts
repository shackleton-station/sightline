import { describe, expect, it } from 'vitest'
import { patchGrid } from './lightGrid'
import type { LightMeta, LightPatch } from './lightGrid'
import { DEFAULT_REQUIREMENTS } from './mission'
import { fitField, type GridGaps, layPatch } from './missionGrid'

const REQ = DEFAULT_REQUIREMENTS

/** Gaps over a square grid: the Sun and Earth up at landing everywhere, and a dark spell where `dark` says. */
function gapsOf(size: number, dark: (col: number, row: number) => boolean): GridGaps {
  const cells = size * size
  const gaps: GridGaps = { size, sunAt: new Uint8Array(cells).fill(1), earthAt: new Uint8Array(cells).fill(1), sunGapH: new Uint16Array(cells), earthGapH: new Uint16Array(cells) }
  for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) if (dark(col, row)) gaps.sunGapH[row * size + col] = 500
  return gaps
}

describe('a patch laid into the field of where a landing fits', () => {
  // A grid of 8 cells; a patch of its middle 2 by 2 cells, each cell 6 by 6 patch pixels.
  const SIZE = 8
  const SUB = 2
  const patch: LightPatch = { size: 12, pixel_m: 20, col: 3, row: 3, cells: 2, sub: 6 }
  const side = SIZE * SUB
  const at = (field: Float32Array, col: number, row: number) => field[row * side + col]

  it('tells apart ground the grid’s one value a cell could not', () => {
    // The grid says the whole of cell (3, 3) is dark. The patch says only its left half is.
    const grid = gapsOf(SIZE, (col, row) => col === 3 && row === 3)
    const fine = gapsOf(patch.size, (col, row) => col < 3 && row < 6)
    const field = fitField(grid, REQ, SUB, null)
    expect(at(field, 6, 6)).toBe(0)
    expect(at(field, 7, 6)).toBe(0)
    layPatch(field, SUB, SIZE, patch, fine, REQ, null)
    // Each field pixel is three by three patch pixels: the left one is all dark, the right one all lit.
    expect(at(field, 6, 6)).toBe(0)
    expect(at(field, 7, 6)).toBe(1)
    expect(at(field, 6, 7)).toBe(0)
    expect(at(field, 7, 7)).toBe(1)
  })

  it('gives a pixel the share of its patch pixels that fit', () => {
    const grid = gapsOf(SIZE, () => false)
    // One column of patch pixels dark: a third of the field pixels over it.
    const fine = gapsOf(patch.size, (col) => col === 4)
    const field = fitField(grid, REQ, SUB, null)
    layPatch(field, SUB, SIZE, patch, fine, REQ, null)
    expect(at(field, 7, 6)).toBeCloseTo(2 / 3, 6)
    expect(at(field, 6, 6)).toBe(1)
  })

  it('changes nothing outside the patch, and scales a pixel by the share of it that is not too steep', () => {
    const grid = gapsOf(SIZE, (col) => col === 0)
    const fine = gapsOf(patch.size, () => false)
    const flat = new Float32Array(side * side).fill(1)
    flat[6 * side + 6] = 0
    flat[8 * side + 8] = 0.5
    const before = fitField(grid, REQ, SUB, flat)
    const field = Float32Array.from(before)
    layPatch(field, SUB, SIZE, patch, fine, REQ, flat)
    for (let row = 0; row < side; row += 1) {
      for (let col = 0; col < side; col += 1) {
        const inside = col >= 6 && col < 10 && row >= 6 && row < 10
        if (!inside) expect(at(field, col, row)).toBe(at(before, col, row))
      }
    }
    expect(at(field, 6, 6)).toBe(0)
    expect(at(field, 7, 6)).toBe(1)
    // Half of a pixel level: half of what its patch pixels say.
    expect(at(field, 8, 8)).toBe(0.5)
  })

  it('is left alone when the patch’s pixels do not divide the field’s, or the gaps are not the patch’s', () => {
    const grid = gapsOf(SIZE, () => true)
    const field = fitField(grid, REQ, SUB, null)
    layPatch(field, SUB, SIZE, { ...patch, sub: 5, size: 10 }, gapsOf(10, () => false), REQ, null)
    layPatch(field, SUB, SIZE, patch, gapsOf(10, () => false), REQ, null)
    expect(Array.from(field).every((value) => value === 0)).toBe(true)
  })

  it('is read as a grid of its own: the grid’s months at the patch’s size', () => {
    const meta = { size: 1024, pixel_m: 120, half_width_m: 61440, radius_m: 1737400, x_axis_lon_deg: 90, y_axis_lon_deg: 0, obs_height_m: 2, sun_slots: 16, earth_slots: 4, hours: { '2027-05': 744 }, patches: { here: patch } } satisfies LightMeta
    const grid = patchGrid(meta, patch)
    expect(grid.size).toBe(12)
    expect(grid.pixel_m).toBe(20)
    expect(grid.hours).toBe(meta.hours)
    expect(grid.sun_slots).toBe(16)
    expect(grid.patches).toBeUndefined()
  })
})
