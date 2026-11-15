import { describe, expect, it } from 'vitest'
import { firstSentence, ringedSites, sitesNamedIn } from './scoutRing'

const SITES = [
  { id: 'apollo-11', name: 'Apollo 11' },
  { id: 'apollo-15', name: 'Apollo 15' },
  { id: 'apollo-17', name: 'Apollo 17' },
  { id: 'connecting-ridge', name: 'Connecting Ridge' },
  { id: 'shackleton-rim', name: 'Shackleton Rim' },
  { id: 'peak-near-shackleton', name: 'Peak near Shackleton' },
  { id: 'chandrayaan-3', name: 'Chandrayaan-3 (India)' },
  { id: 'slim', name: 'SLIM (Japan)' },
]
const none = () => null

describe('the first sentence of a reply', () => {
  it('ends at the first full stop that ends a sentence, not at a decimal point or inside a time', () => {
    expect(firstSentence('Earth sits 3.3° above the skyline at 00:00 UTC. It sets in 12 d 12 h.')).toBe('Earth sits 3.3° above the skyline at 00:00 UTC.')
    expect(firstSentence('Is it up? Yes.')).toBe('Is it up?')
    expect(firstSentence('No full stop here')).toBe('No full stop here')
  })
})

describe('the sites a text names', () => {
  it('are found in the order they are named, each once, as whole names', () => {
    expect(sitesNamedIn('SLIM (Japan), then Apollo 17 and Apollo 11, and Apollo 17 again', SITES)).toEqual(['slim', 'apollo-17', 'apollo-11'])
    expect(sitesNamedIn('Apollo 110 and Shackleton Rimland are not sites', SITES)).toEqual([])
    expect(sitesNamedIn('Peak near Shackleton, not the rim', SITES)).toEqual(['peak-near-shackleton'])
  })
})

describe('the sites the Moon rings for a reply', () => {
  it('are the ones the first sentence names, not one named further down', () => {
    // The reply Rodrigo got: it led with Connecting Ridge, and the Moon went to Apollo 11, first in the list of sites.
    const reply = { text: 'At Connecting Ridge, the site on your screen, Earth is out of view at 10 December 2026, 00:00 UTC. These sites had it all month: Apollo 11, Apollo 15, Apollo 17 and SLIM (Japan).' }
    expect(ringedSites(reply, SITES, none)).toEqual(['connecting-ridge'])
  })

  it('are every site of a list the first sentence gives', () => {
    const reply = { text: 'At the hour on the time bar, 10 December 2026, 00:00 UTC, Earth is in view from Apollo 11, Apollo 15, Apollo 17, Chandrayaan-3 (India) and SLIM (Japan). Connecting Ridge has it again in 3 d 1 h.' }
    expect(ringedSites(reply, SITES, none)).toEqual(['apollo-11', 'apollo-15', 'apollo-17', 'chandrayaan-3', 'slim'])
  })

  it('fall back to the site the first button opens, then to the first site named anywhere, then to none', () => {
    const later = { text: 'It depends on the month. Shackleton Rim does best, then Apollo 11.', actions: [{ hash: '#a=apollo-15@2027-05' }] }
    expect(ringedSites(later, SITES, () => 'apollo-15')).toEqual(['apollo-15'])
    expect(ringedSites(later, SITES, none)).toEqual(['shackleton-rim'])
    expect(ringedSites({ text: 'I can only answer from the data.' }, SITES, none)).toEqual([])
  })
})
