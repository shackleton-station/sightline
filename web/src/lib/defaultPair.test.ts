import { describe, expect, it } from 'vitest'
import { DEFAULT_PAIR, defaultScenarios } from './defaultPair'

const SITES = ['connecting-ridge', 'shackleton-rim', 'apollo-11']

describe('the two scenarios Plan starts with', () => {
  it('are the two prospective sites at the same hour: A at Connecting Ridge, B at Shackleton Rim', () => {
    expect(DEFAULT_PAIR).toEqual(['connecting-ridge', 'shackleton-rim'])
    expect(defaultScenarios(SITES, 120)).toEqual([
      { site: 'connecting-ridge', landing: 120 },
      { site: 'shackleton-rim', landing: 120 },
    ])
  })

  it('put a site picked on the Moon at A, with Connecting Ridge at B, or Shackleton Rim when A is Connecting Ridge', () => {
    expect(defaultScenarios(SITES, 7, 'apollo-11').map((one) => one.site)).toEqual(['apollo-11', 'connecting-ridge'])
    expect(defaultScenarios(SITES, 7, 'shackleton-rim').map((one) => one.site)).toEqual(['shackleton-rim', 'connecting-ridge'])
    expect(defaultScenarios(SITES, 7, 'connecting-ridge').map((one) => one.site)).toEqual(['connecting-ridge', 'shackleton-rim'])
    // A custom point is A like any other.
    expect(defaultScenarios(SITES, 7, '-88.5,40').map((one) => one.site)).toEqual(['-88.5,40', 'connecting-ridge'])
  })

  it('are one scenario when the other site of the pair is not on hand', () => {
    expect(defaultScenarios(['apollo-11'], 3)).toEqual([{ site: 'apollo-11', landing: 3 }])
    expect(defaultScenarios(['connecting-ridge', 'apollo-11'], 3)).toEqual([{ site: 'connecting-ridge', landing: 3 }])
  })
})
