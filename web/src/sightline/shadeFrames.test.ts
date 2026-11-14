import { describe, expect, it } from 'vitest'
import { type Frame, keepFrame, nextWanted, pickFrames } from './shadeFrames'

/** A stand-in for a picture: only which one it is matters here. */
const picture = (name: string) => ({ name }) as unknown as HTMLCanvasElement
const frame = (sign: string, hour: number, name: string | null = `${sign}@${hour}`): Frame => ({ sign, hour, picture: name === null ? null : picture(name) })
const named = (picked: { from: HTMLCanvasElement; to: HTMLCanvasElement; mix: number } | null) =>
  picked && { from: (picked.from as unknown as { name: string }).name, to: (picked.to as unknown as { name: string }).name, mix: picked.mix }

describe('which pictures to blend', () => {
  it('blends the key frames either side of the hour, by how far between them it is', () => {
    const frames = [frame('a', 24), frame('a', 48)]
    expect(named(pickFrames(frames, 'a', 30, 24))).toEqual({ from: 'a@24', to: 'a@48', mix: 0.25 })
    expect(named(pickFrames(frames, 'a', 47, 24))).toEqual({ from: 'a@24', to: 'a@48', mix: 23 / 24 })
  })

  it('shows the hour’s own picture once there is one', () => {
    const frames = [frame('a', 24), frame('a', 48), frame('a', 30)]
    expect(named(pickFrames(frames, 'a', 30, 24))).toEqual({ from: 'a@30', to: 'a@30', mix: 0 })
    // On a key frame's hour, the key frame is the hour's own.
    expect(named(pickFrames(frames, 'a', 24, 24))).toEqual({ from: 'a@24', to: 'a@24', mix: 0 })
  })

  it('makes do with one key frame while the other is on the way', () => {
    expect(named(pickFrames([frame('a', 48)], 'a', 30, 24))).toEqual({ from: 'a@48', to: 'a@48', mix: 0 })
    expect(named(pickFrames([frame('a', 24)], 'a', 30, 24))).toEqual({ from: 'a@24', to: 'a@24', mix: 0 })
  })

  it('holds the nearest picture rather than none: of this setting first, then of any', () => {
    const frames = [frame('a', 240), frame('a', 600), frame('b', 30)]
    expect(named(pickFrames(frames, 'a', 300, 24))).toEqual({ from: 'a@240', to: 'a@240', mix: 0 })
    expect(named(pickFrames(frames, 'c', 300, 24))).toEqual({ from: 'a@240', to: 'a@240', mix: 0 })
    expect(named(pickFrames(frames, 'c', 40, 24))).toEqual({ from: 'b@30', to: 'b@30', mix: 0 })
  })

  it('is none with nothing to show, and passes over a moment with no picture', () => {
    expect(pickFrames([], 'a', 30, 24)).toBeNull()
    expect(pickFrames([frame('a', 24, null)], 'a', 30, 24)).toBeNull()
    // Past the data's end there is no picture for the later key frame: the earlier one stands alone.
    expect(named(pickFrames([frame('a', 24), frame('a', 48, null)], 'a', 30, 24))).toEqual({ from: 'a@24', to: 'a@24', mix: 0 })
  })
})

describe('which picture to ask for next', () => {
  it('asks for the key frame before the hour, then the one after', () => {
    expect(nextWanted([], 'a', 30, 24, false)).toBe(24)
    expect(nextWanted([frame('a', 24)], 'a', 30, 24, false)).toBe(48)
    expect(nextWanted([frame('a', 24), frame('a', 48)], 'a', 30, 24, false)).toBeNull()
  })

  it('asks for the hour’s own picture first, once the bar rests', () => {
    expect(nextWanted([], 'a', 30, 24, true)).toBe(30)
    expect(nextWanted([frame('a', 30)], 'a', 30, 24, true)).toBe(24)
    expect(nextWanted([frame('a', 30), frame('a', 24), frame('a', 48)], 'a', 30, 24, true)).toBeNull()
  })

  it('does not ask again for a moment known to have no picture, and asks afresh for a new setting', () => {
    expect(nextWanted([frame('a', 24), frame('a', 48, null)], 'a', 30, 24, false)).toBeNull()
    expect(nextWanted([frame('a', 24), frame('a', 48)], 'b', 30, 24, false)).toBe(24)
  })
})

describe('the pictures kept', () => {
  it('lets go of the oldest past the limit', () => {
    const frames: Frame[] = []
    for (const hour of [0, 24, 48, 72]) keepFrame(frames, frame('a', hour), 3)
    expect(frames.map((kept) => kept.hour)).toEqual([24, 48, 72])
  })
})
