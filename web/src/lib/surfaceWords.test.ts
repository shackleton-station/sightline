import { describe, expect, it } from 'vitest'
import { skyTagWords } from './surfaceWords'

describe("the lines under the Sun's and Earth's names in Surface", () => {
  it('say the skyline first, then eye level, in words', () => {
    expect(skyTagWords(1.23, -2.41, 0.95, true)).toEqual({ skyline: '1.2° above the skyline', level: '2.4° below eye level' })
    expect(skyTagWords(0.6, 0.6, 0.27, true)).toEqual({ skyline: '0.6° above the skyline', level: '0.6° above eye level' })
  })

  it('say how far under the skyline a hidden body is', () => {
    expect(skyTagWords(-0.84, -3.2, 0.27, false)).toEqual({ skyline: '0.8° below the skyline', level: '3.2° below eye level' })
  })

  it('speak of the top edge when the centre is under the skyline and part of the disc still shows', () => {
    expect(skyTagWords(-0.3, -2.9, 0.92, true)).toEqual({ skyline: 'top edge 0.6° above the skyline', level: '2.9° below eye level' })
  })
})
