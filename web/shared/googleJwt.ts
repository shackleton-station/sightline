import { webcrypto } from 'node:crypto'

/**
 * Tokens signed by Google (JWTs), checked without trusting whoever sent them. Two uses share this:
 * a visitor's sign-in token (`shared/identity.ts`) and the token one Google Cloud service presents
 * to another, such as Pub/Sub pushing a message to the events worker (`shared/caller.ts`).
 */

/** One of Google's public signing keys, as published. */
export interface SigningKey {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
}

/** Fetches Google's current signing keys, and how long they may be kept. */
export type KeySource = () => Promise<{ keys: SigningKey[]; keepMs: number }>

const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com']
/** Clocks differ a little between machines. */
const SKEW_S = 30

export const googleKeys: KeySource = async () => {
  const response = await fetch(GOOGLE_KEYS, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Google keys: HTTP ${response.status}`)
  const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1]
  const { keys } = (await response.json()) as { keys: SigningKey[] }
  return { keys, keepMs: (maxAge ? Number(maxAge) : 3600) * 1000 }
}

function decode(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A token taken apart, with nothing about it checked yet. */
export interface TokenParts {
  header: Record<string, unknown>
  claims: Record<string, unknown>
  /** The two parts the signature covers, exactly as sent. */
  signed: string
  signature: string
}

export function tokenParts(token: string): TokenParts | null {
  const parts = token.split('.')
  if (parts.length !== 3 || token.length > 4096) return null
  const header = decode(parts[0])
  const claims = decode(parts[1])
  return header && claims ? { header, claims, signed: `${parts[0]}.${parts[1]}`, signature: parts[2] } : null
}

/** Issued by Google, not expired, and not dated in the future. Says nothing about the signature. */
export function issuedByGoogleAndCurrent(claims: Record<string, unknown>, nowMs: number): boolean {
  const seconds = nowMs / 1000
  if (!ISSUERS.includes(String(claims.iss))) return false
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < seconds) return false
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > seconds) return false
  return true
}

export interface GoogleTokens {
  /**
   * The claims of a token, if Google signed it, Google issued it and it has not expired; null
   * otherwise. Who it was issued for (`aud`) and who it names are the caller's to check.
   */
  verify(token: string): Promise<Record<string, unknown> | null>
}

/** `what` names the use in the one warning this can log, when Google's keys cannot be fetched. */
export function googleTokens(source: KeySource = googleKeys, now: () => number = Date.now, what = 'Sign-in'): GoogleTokens {
  let keys = new Map<string, SigningKey>()
  let freshUntil = 0
  let lastFetch = Number.NEGATIVE_INFINITY

  /** The key a token names. Google rotates keys, so an unknown name means fetch again, at most once a minute. */
  async function keyFor(kid: string): Promise<SigningKey | null> {
    const stale = now() >= freshUntil
    if ((stale || !keys.has(kid)) && now() - lastFetch >= 60_000) {
      lastFetch = now()
      try {
        const fetched = await source()
        keys = new Map(fetched.keys.map((key) => [key.kid, key]))
        freshUntil = now() + fetched.keepMs
      } catch (error) {
        console.warn(`${what}: could not fetch Google's keys:`, error instanceof Error ? error.message : error)
      }
    }
    return keys.get(kid) ?? null
  }

  return {
    async verify(token) {
      const parts = tokenParts(token)
      // Only the algorithm Google uses. A token naming "none" or a shared-secret algorithm stops here.
      if (!parts || parts.header.alg !== 'RS256' || typeof parts.header.kid !== 'string') return null

      const key = await keyFor(parts.header.kid)
      if (!key || key.kty !== 'RSA') return null
      const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      const publicKey = await webcrypto.subtle.importKey('jwk', { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true }, algorithm, false, ['verify'])
      const signed = await webcrypto.subtle.verify(algorithm, publicKey, Buffer.from(parts.signature, 'base64url'), Buffer.from(parts.signed))
      if (!signed) return null
      return issuedByGoogleAndCurrent(parts.claims, now()) ? parts.claims : null
    },
  }
}
