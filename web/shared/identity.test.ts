import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { googleIdentity, ownerOf, whoIs, type KeySource, type SigningKey } from './identity'

const CLIENT = 'our-site.apps.example'
const NOW = Date.parse('2026-11-12T12:00:00Z')

// A stand-in for Google: a key pair made here, published the way Google publishes its own.
function signer(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  return { kid, privateKey, published: { kid, kty: 'RSA', n: jwk.n ?? '', e: jwk.e ?? '', alg: 'RS256' } satisfies SigningKey }
}
const google = signer('key-1')
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

function token(claims: Record<string, unknown> = {}, options: { key?: { kid: string; privateKey: KeyObject }; header?: Record<string, unknown> } = {}) {
  const key = options.key ?? google
  const head = part({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...options.header })
  const body = part({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234567890', iat: NOW / 1000 - 60, exp: NOW / 1000 + 3540, email: 'someone@example.com', ...claims })
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.privateKey).toString('base64url')
  return `${head}.${body}.${signature}`
}

const keys = (...published: SigningKey[]): KeySource => () => Promise.resolve({ keys: published, keepMs: 3_600_000 })
const identity = (source: KeySource = keys(google.published), now = () => NOW) => googleIdentity(CLIENT, source, now)

describe('sign-in with Google', () => {
  it('accepts a token Google signed for this site, and keeps only a fingerprint of who it is', async () => {
    const owner = await identity().verify(token())
    expect(owner).toBe(ownerOf(CLIENT, '1234567890'))
    expect(owner).toMatch(/^[0-9a-f]{32}$/)
    // Not the account id, not the email, and not the same fingerprint another site would get.
    expect(owner).not.toContain('1234567890')
    expect(ownerOf('another-site.apps.example', '1234567890')).not.toBe(owner)
    expect(await identity().verify(token({ iss: 'accounts.google.com' }))).toBe(owner)
  })

  it('refuses a token meant for another site, an expired one, and one from another issuer', async () => {
    const check = identity()
    expect(await check.verify(token({ aud: 'another-site.apps.example' }))).toBeNull()
    expect(await check.verify(token({ exp: NOW / 1000 - 3600 }))).toBeNull()
    expect(await check.verify(token({ iat: NOW / 1000 + 3600 }))).toBeNull()
    expect(await check.verify(token({ iss: 'https://accounts.evil.example' }))).toBeNull()
    expect(await check.verify(token({ sub: '' }))).toBeNull()
    // A few seconds of clock difference is fine.
    expect(await check.verify(token({ exp: NOW / 1000 - 10 }))).not.toBeNull()
  })

  it('refuses anything not signed by one of Google\'s keys', async () => {
    const check = identity()
    const impostor = signer('key-1') // claims Google's key name, signs with its own key
    expect(await check.verify(token({}, { key: impostor }))).toBeNull()
    expect(await check.verify(token({}, { key: signer('unknown-key') }))).toBeNull()

    // Changing the claims after signing breaks the signature.
    const [head, , signature] = token().split('.')
    const altered = part({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'someone-else', exp: NOW / 1000 + 3540 })
    expect(await check.verify(`${head}.${altered}.${signature}`)).toBeNull()

    // "No signature needed" and shared-secret algorithms are never accepted.
    const unsigned = `${part({ alg: 'none', kid: 'key-1' })}.${token().split('.')[1]}.`
    expect(await check.verify(unsigned)).toBeNull()
    expect(await check.verify(token({}, { header: { alg: 'HS256' } }))).toBeNull()
    for (const junk of ['', 'abc', 'a.b', 'a.b.c', 'x'.repeat(5000)]) expect(await check.verify(junk)).toBeNull()
  })

  it('fetches Google\'s keys once and keeps them, and looks again when Google starts using a new one', async () => {
    let clock = NOW
    const rotated = signer('key-2')
    const source = vi.fn<KeySource>().mockResolvedValueOnce({ keys: [google.published], keepMs: 3_600_000 }).mockResolvedValue({ keys: [google.published, rotated.published], keepMs: 3_600_000 })
    const check = identity(source, () => clock)
    await check.verify(token())
    await check.verify(token())
    expect(source).toHaveBeenCalledTimes(1)

    // A key name it hasn't seen: fetch again, but not more than once a minute however many arrive.
    clock += 61_000
    expect(await check.verify(token({}, { key: rotated }))).not.toBeNull()
    expect(source).toHaveBeenCalledTimes(2)
    await check.verify(token({}, { key: signer('made-up-1') }))
    await check.verify(token({}, { key: signer('made-up-2') }))
    expect(source).toHaveBeenCalledTimes(2)
  })

  it('keeps working on the keys it has when Google cannot be reached', async () => {
    let clock = NOW
    const source = vi.fn<KeySource>().mockResolvedValueOnce({ keys: [google.published], keepMs: 1000 }).mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const check = identity(source, () => clock)
    expect(await check.verify(token())).not.toBeNull()
    clock += 120_000
    expect(await check.verify(token())).not.toBeNull()
    expect(source).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('whoIs', () => {
  const request = (authorization?: string) => new Request('https://site.example/api/plans', { headers: authorization ? { authorization } : {} })
  it('tells apart no token, a good one and a bad one', async () => {
    const check = identity()
    expect(await whoIs(request(), check)).toEqual({ kind: 'none' })
    expect(await whoIs(request('Basic abc'), check)).toEqual({ kind: 'none' })
    expect(await whoIs(request(`Bearer ${token()}`), check)).toEqual({ kind: 'owner', owner: ownerOf(CLIENT, '1234567890') })
    expect(await whoIs(request('Bearer nonsense'), check)).toEqual({ kind: 'invalid' })
    expect(await whoIs(request(`Bearer ${token()}`), null)).toEqual({ kind: 'invalid' })
  })
})
