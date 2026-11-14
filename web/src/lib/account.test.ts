import { describe, expect, it } from 'vitest'
import { accountFromToken } from './account'

const part = (value: object) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const token = (claims: object) => `${part({ alg: 'RS256' })}.${part(claims)}.signature`

describe('accountFromToken', () => {
  it('reads a first name and the expiry, for display only', () => {
    expect(accountFromToken(token({ given_name: 'Zoë', name: 'Zoë Example', exp: 1_800_000_000 }))).toEqual({
      token: token({ given_name: 'Zoë', name: 'Zoë Example', exp: 1_800_000_000 }),
      name: 'Zoë',
      expiresAt: 1_800_000_000_000,
    })
    expect(accountFromToken(token({ name: 'Full Name', exp: 1 }))?.name).toBe('Full Name')
    expect(accountFromToken(token({ exp: 1 }))?.name).toBe('')
  })

  it('gives nothing for something that is not a token', () => {
    for (const junk of ['', 'abc', 'a.b.c', token({ name: 'No expiry' }), `x.${btoa('not json')}.y`]) expect(accountFromToken(junk)).toBeNull()
  })
})
