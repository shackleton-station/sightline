import { describe, expect, it } from 'vitest'
import { shortTime } from '../lib/river'
import { lookFrom, sunState } from './looks'
import { cardPlace, TOUR } from './tour'

describe('lookFrom', () => {
  it('reads the look from the address and falls back to Observatory', () => {
    expect(lookFrom('#a=shackleton-rim&look=b')).toBe('b')
    expect(lookFrom('#look=c')).toBe('c')
    expect(lookFrom('#a=shackleton-rim')).toBe('a')
    expect(lookFrom('#look=z')).toBe('a')
    expect(lookFrom('')).toBe('a')
  })
})

describe('sunState', () => {
  it('is shadow when the Sun is not up, whatever the fraction', () => {
    expect(sunState(false, 0)).toBe('shadow')
    expect(sunState(false)).toBe('shadow')
  })

  it('is horizon when only part of the disk is in view', () => {
    expect(sunState(true, 0.4)).toBe('horizon')
    expect(sunState(true, 1)).toBe('sun')
  })

  it('is sun for a tapped spot, which only knows up or not', () => {
    expect(sunState(true)).toBe('sun')
  })
})

describe('shortTime', () => {
  it('shortens an ISO hour for the time bar', () => {
    expect(shortTime('2027-05-13T12:00:00Z')).toBe('13 May · 12:00 UTC')
    expect(shortTime('2027-01-01T00:00:00Z')).toBe('1 Jan · 00:00 UTC')
  })
})

describe('the tour', () => {
  it('has a welcome then one step per part of the page, each named once', () => {
    expect(TOUR[0].target).toBeNull()
    const targets = TOUR.slice(1).map((step) => step.target)
    expect(targets).toEqual(['place', 'layers', 'time', 'scout'])
  })

  const view = { width: 1440, height: 900 }
  const card = { width: 400, height: 260 }

  it('centers the welcome card', () => {
    expect(cardPlace(null, view, card)).toEqual({ left: 520, top: 320 })
  })

  it('puts the card under a target near the top', () => {
    const place = cardPlace({ left: 1100, top: 80, width: 300, height: 50 }, view, card)
    expect(place.top).toBe(146)
    // Kept inside the window on the right.
    expect(place.left).toBe(1440 - 400 - 16)
  })

  it('puts the card above a target near the bottom', () => {
    const place = cardPlace({ left: 400, top: 830, width: 640, height: 50 }, view, card)
    expect(place.top).toBe(830 - 16 - 260)
    expect(place.left).toBe(520)
  })
})
