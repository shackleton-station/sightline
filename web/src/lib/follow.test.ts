import { describe, expect, it } from 'vitest'
import { addressOf, addressText, followLink, readAddress, roomFrom } from './follow'
import { SITE_PATHS, tabLinks } from './siteTabs'

const VIEW = '#a=connecting-ridge@2027-05&t=120&limits=14_72_72_1_1&view=3d&mode=learn'

describe('the address a presenter shares', () => {
  it('is the page, the query and the hash of the browser, without the room being followed', () => {
    expect(addressOf({ pathname: '/scout/', search: '', hash: VIEW })).toEqual({ path: '/scout/', query: '', hash: VIEW })
    expect(addressOf({ pathname: '/', search: '?ui=next', hash: VIEW })).toEqual({ path: '/', query: '?ui=next', hash: VIEW })
    expect(addressOf({ pathname: '/', search: '?follow=abc234', hash: '' })).toEqual({ path: '/', query: '', hash: '' })
    expect(addressOf({ pathname: '/', search: '?follow=abc234&ui=next', hash: '#' })).toEqual({ path: '/', query: '?ui=next', hash: '' })
    expect(addressOf({ pathname: '/atlas/index.html', search: '', hash: `${VIEW}&layer=both` })?.path).toBe('/atlas/')
    // A page that is not one of the tabs is not shared.
    expect(addressOf({ pathname: '/gpu/', search: '', hash: '' })).toBeNull()
  })

  it('covers every tab, and nothing but the tabs', () => {
    expect(SITE_PATHS).toEqual(['/', '/classic/', '/scout/', '/planner/', '/atlas/', '/briefing/', '/surface/', '/hype/'])
    for (const tab of tabLinks(VIEW)) {
      const url = new URL(tab.href, 'https://site.example')
      const address = addressOf(url)
      expect(address, tab.id).not.toBeNull()
      // What a follower's browser is sent to is the tab's own link.
      expect(new URL(addressText(address as NonNullable<typeof address>), 'https://site.example').href).toBe(url.href)
    }
  })

  it('never leaves this site, whatever is published', () => {
    for (const path of ['https://evil.example/', '//evil.example/', '/\\evil.example/', 'scout/', '/scout', '/scout/../', '/api/rooms', '']) {
      expect(readAddress({ path, query: '', hash: '' }), path).toBeNull()
    }
    expect(readAddress({ path: '/', query: '?to=https://evil.example/', hash: '#//evil.example' })).not.toBeNull()
    for (const address of SITE_PATHS.map((path) => ({ path, query: '?to=https://evil.example/', hash: '#//evil.example/@x' }))) {
      expect(new URL(addressText(address), 'https://site.example').origin).toBe('https://site.example')
    }
  })

  it('reads the room from a link, and only a well-formed one', () => {
    expect(followLink('https://lunarsightline.com', 'abc234')).toBe('https://lunarsightline.com/?follow=abc234')
    expect(roomFrom('?follow=abc234')).toBe('abc234')
    expect(roomFrom('?ui=next&follow=abc234')).toBe('abc234')
    for (const search of ['', '?follow=', '?follow=ABC234', '?follow=abc23', '?follow=abc2345', '?follow=abc10l', '?follow=../x']) expect(roomFrom(search), search).toBeNull()
  })
})
