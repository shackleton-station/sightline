import { describe, expect, it } from 'vitest'
import { BROWSER_HEADER as PAGE_HEADER } from '../src/lib/browserId'
import { BROWSER_HEADER, browserOf, visitorKeys } from './http'

const request = (headers: Record<string, string>) => new Request('https://example.test/api/chat', { method: 'POST', headers })

describe('visitorKeys', () => {
  it('is the address alone without a browser id, as before the header', () => {
    expect(visitorKeys(request({ 'x-forwarded-for': '203.0.113.7' }))).toEqual({ address: '203.0.113.7', visitor: '203.0.113.7' })
  })

  it('splits one address by the browser id the page sends', () => {
    const keys = visitorKeys(request({ 'x-forwarded-for': '203.0.113.7', [BROWSER_HEADER]: '0123456789abcdef0123456789abcdef' }))
    expect(keys).toEqual({ address: '203.0.113.7', visitor: '203.0.113.7~0123456789abcdef0123456789abcdef' })
  })

  it('reads the address the same way as before, skipping our own proxies', () => {
    const keys = visitorKeys(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 10.0.0.1', [BROWSER_HEADER]: 'abcdefghijklmnop' }), ['10.0.0.1'])
    expect(keys.address).toBe('203.0.113.7')
  })
})

describe('browserOf', () => {
  it.each([
    ['', null],
    ['too-short', null],
    ['has spaces in it, sixteen+', null],
    ['x'.repeat(65), null],
    ['abc/def/ghi/jkl/mno', null],
    ['0123456789abcdef', '0123456789abcdef'],
    ['  0123456789abcdef  ', '0123456789abcdef'],
  ])('%j -> %j', (value, expected) => {
    expect(browserOf(request({ [BROWSER_HEADER]: value }))).toBe(expected)
  })

  it('is the same header the page sends', () => {
    expect(PAGE_HEADER).toBe(BROWSER_HEADER)
  })
})
