import { describe, expect, it } from 'vitest'
import { weavePairs, weaveSlots } from './lightLayer'

// Three cells, with each slot's plane holding the slot number in the tens and the cell in the units.
const CELLS = 3
const planes = (slots: number) => Uint16Array.from({ length: slots * CELLS }, (_, i) => Math.floor(i / CELLS) * 10 + (i % CELLS))

describe('flips on their way to the graphics card', () => {
  it('weaves four slot planes into one texel per cell', () => {
    // Cell 1's texel holds slots 0 to 3 of cell 1.
    expect([...weaveSlots(planes(4), 0, CELLS)]).toEqual([0, 10, 20, 30, 1, 11, 21, 31, 2, 12, 22, 32])
  })

  it('weaves eight slot planes into pairs: a run’s start in the low half, its end in the high half', () => {
    const woven = weavePairs(planes(16), 8, CELLS)
    // Cell 2, second channel: slots 10 and 11 of the sixteen.
    expect(woven[2 * 4 + 1] & 0xffff).toBe(102)
    expect(woven[2 * 4 + 1] >>> 16).toBe(112)
    // Every channel of every cell holds a start and the end that follows it.
    for (let cell = 0; cell < CELLS; cell++) {
      for (let channel = 0; channel < 4; channel++) {
        const texel = woven[cell * 4 + channel]
        expect([texel & 0xffff, texel >>> 16]).toEqual([(8 + 2 * channel) * 10 + cell, (9 + 2 * channel) * 10 + cell])
      }
    }
  })

  it('keeps an hour count that needs all sixteen bits', () => {
    const woven = weavePairs(new Uint16Array(8 * CELLS).fill(65535), 0, CELLS)
    expect(woven[0]).toBe(0xffffffff)
  })
})
