import { createHash } from 'node:crypto'
import { googleKeys, googleTokens, type KeySource } from '../shared/googleJwt'

export type { KeySource, SigningKey } from '../shared/googleJwt'

/**
 * Sign-in with Google, checked on the server.
 *
 * The browser gets a signed token from Google (a JWT) and sends it with a request. Nothing here
 * trusts the browser: the server checks Google's signature on the token, that it was issued for
 * this site and nobody else's, and that it hasn't expired. There is no session of our own to store
 * or steal; the token is the session, and Google makes it last an hour.
 *
 * The signature, issuer and expiry checks live in `shared/googleJwt.ts`, which the events worker
 * also uses for the token Pub/Sub presents.
 */
export interface Identity {
  /** The id sign-in is set up with; the browser needs it to show Google's button. Not a secret. */
  clientId: string
  /**
   * Who a token belongs to, as a fingerprint that is stable for one person on this site and says
   * nothing else about them. Null if the token doesn't check out.
   */
  verify(token: string): Promise<string | null>
}

/** The fingerprint kept as a plan's owner: one-way, and different on any other site. */
export function ownerOf(clientId: string, subject: string): string {
  return createHash('sha256').update(`${clientId}:${subject}`).digest('hex').slice(0, 32)
}

export function googleIdentity(clientId: string, source: KeySource = googleKeys, now: () => number = Date.now): Identity {
  const tokens = googleTokens(source, now)
  return {
    clientId,
    async verify(token) {
      // Signed by Google, issued by Google, and not expired.
      const claims = await tokens.verify(token)
      if (!claims) return null
      // But for whom? A token issued for another site must not work here.
      if (claims.aud !== clientId) return null
      if (typeof claims.sub !== 'string' || claims.sub === '') return null
      return ownerOf(clientId, claims.sub)
    },
  }
}

/**
 * Who is asking, from the request's `Authorization: Bearer …` header.
 * `none`: no token was sent. `invalid`: one was sent and didn't check out (expired, most often).
 */
export async function whoIs(request: Request, identity: Identity | null | undefined): Promise<{ kind: 'none' } | { kind: 'invalid' } | { kind: 'owner'; owner: string }> {
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return { kind: 'none' }
  const owner = identity ? await identity.verify(header.slice('Bearer '.length).trim()) : null
  return owner ? { kind: 'owner', owner } : { kind: 'invalid' }
}
