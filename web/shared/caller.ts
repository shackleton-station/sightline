import { type GoogleTokens, issuedByGoogleAndCurrent, tokenParts } from './googleJwt'

/**
 * Which Google Cloud identity is calling this service.
 *
 * A private Cloud Run service is guarded twice. First by Cloud Run itself: it refuses any request
 * whose token is not signed by Google, not meant for this service, or from an identity without
 * permission to call it. That check happens before our code runs. Second, here: permission to call
 * the service is not the same as being the one caller an endpoint expects (the deployer may call
 * the service too, to test it), so each endpoint also asks who is calling.
 */
export type Caller = { ok: true; email: string } | { ok: false; why: 'missing' | 'invalid' }

export interface Callers {
  /** Who sent the request, from its `Authorization: Bearer …` header. */
  identify(authorization: string | null): Promise<Caller>
}

/**
 * What Cloud Run puts in place of a token's signature after checking it, in the cases its
 * documentation names (so a service cannot replay the token elsewhere). Whether it also does so
 * for a service account's token is not documented, so both forms are handled: a token that still
 * has its signature is checked against Google's keys here; one whose signature was removed has
 * already been checked by Cloud Run, and is accepted only when this service runs behind it.
 */
export const SIGNATURE_REMOVED = 'SIGNATURE_REMOVED_BY_GOOGLE'

export function googleCallers(options: { tokens: GoogleTokens; behindCloudRun: boolean; now?: () => number }): Callers {
  const now = options.now ?? Date.now
  return {
    async identify(authorization) {
      const header = authorization ?? ''
      if (!header.startsWith('Bearer ')) return { ok: false, why: 'missing' }
      const token = header.slice('Bearer '.length).trim()
      const parts = tokenParts(token)
      if (!parts) return { ok: false, why: 'invalid' }

      let claims: Record<string, unknown> | null
      if (parts.signature === SIGNATURE_REMOVED) claims = options.behindCloudRun && issuedByGoogleAndCurrent(parts.claims, now()) ? parts.claims : null
      else claims = await options.tokens.verify(token)
      // Google sets `email_verified` on a service account's token; without it the email is only a claim.
      if (!claims || claims.email_verified !== true || typeof claims.email !== 'string' || claims.email === '') return { ok: false, why: 'invalid' }
      return { ok: true, email: claims.email }
    },
  }
}
