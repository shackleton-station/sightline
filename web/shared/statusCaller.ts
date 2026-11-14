import { type GoogleTokens, tokenParts } from './googleJwt'

/**
 * Who is asking for a service's status on the path meant for the web server
 * (`/api/plans/status/web`, `/api/chat/status/web`).
 *
 * The web server's `/api/status/services` asks the plans and co-pilot services how they are, with a
 * short-lived token from Google saying "I am `clps-web`" (server/services.ts). Both services are
 * public: anyone may call them, so Cloud Run's own permission check cannot guard one path of
 * them. The check is here, in code, and it is the same three questions the plan names
 * (docs/ARCHITECTURE_PHASE_3.md, section 6):
 *
 * 1. Did Google sign it, and has it not expired? Google's public keys, as for sign-in (`googleJwt.ts`).
 * 2. Was it made for this service? Its audience must be this service's own name. A token the web
 *    server got for the plans service does not work on the co-pilot, and the other way round.
 * 3. Is the caller the web server? The token's verified email must be the web server's identity.
 *
 * The audience is the service's name (`clps-plans`, `clps-copilot`), not its run.app address, on
 * purpose: Cloud Run checks a token whose audience is the service's own address before our code
 * runs, and may strip its signature, which would leave nothing here to check.
 *
 * No secret is stored anywhere: the web server's token comes from Google's metadata server on Cloud
 * Run and lasts about an hour.
 */
export type StatusCaller = { ok: true } | { ok: false; why: 'missing' | 'invalid' | 'not-web' }

export type StatusCheck = (authorization: string | null) => Promise<StatusCaller>

export function statusCaller(options: { tokens: GoogleTokens; audience: string; caller: string }): StatusCheck {
  return async (authorization) => {
    const header = authorization ?? ''
    if (!header.startsWith('Bearer ')) return { ok: false, why: 'missing' }
    const token = header.slice('Bearer '.length).trim()
    if (!tokenParts(token)) return { ok: false, why: 'invalid' }
    const claims = await options.tokens.verify(token)
    if (!claims || claims.aud !== options.audience) return { ok: false, why: 'invalid' }
    // Google sets `email_verified` on a service account's token; without it the email is only a claim.
    if (claims.email_verified !== true || claims.email !== options.caller) return { ok: false, why: 'not-web' }
    return { ok: true }
  }
}
