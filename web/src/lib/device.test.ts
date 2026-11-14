import { describe, expect, it } from 'vitest'
import { opens3dFirst } from './device'

const desktop = { widthPx: 1280, coarsePointer: false, saveData: false, webgl2: true }

describe('opens3dFirst', () => {
  it('opens on a large screen with a mouse', () => {
    expect(opens3dFirst(desktop)).toBe(true)
  })

  it.each([
    ['a phone', { widthPx: 390, coarsePointer: true }],
    ['a large tablet', { widthPx: 1024, coarsePointer: true }],
    ['a narrow window', { widthPx: 800 }],
    ['data saver', { saveData: true }],
    ['no WebGL2', { webgl2: false }],
  ])('waits to be asked on %s', (_, change) => {
    expect(opens3dFirst({ ...desktop, ...change })).toBe(false)
  })
})
