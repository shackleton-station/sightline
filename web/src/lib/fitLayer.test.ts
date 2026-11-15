import { describe, expect, it } from 'vitest'
import { fitLayerOffered } from './fitLayer'

describe('whether "Landings that fit" is offered', () => {
  it('is not, on an address that does not ask for it', () => {
    expect(fitLayerOffered('')).toBe(false)
    expect(fitLayerOffered('?watch=1')).toBe(false)
    expect(fitLayerOffered('?fitlayer=0')).toBe(false)
    expect(fitLayerOffered('?fitlayer')).toBe(false)
  })

  it('is, with fitlayer=1 in the address, among whatever else is there', () => {
    expect(fitLayerOffered('?fitlayer=1')).toBe(true)
    expect(fitLayerOffered('?canary=web&fitlayer=1')).toBe(true)
  })
})
