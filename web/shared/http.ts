/** A small JSON reply that is never cached. */
export function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

/**
 * Whether the request comes from this site's own pages (or an allowed dev origin). The site sits behind
 * Google's front end, which ends TLS, so the scheme isn't compared: only the host.
 */
export function originAllowed(request: Request, allowed: string[]): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  if (allowed.includes(origin)) return true
  try {
    return new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host)
  } catch {
    return false
  }
}

/**
 * The visitor's address, for rate limits. Each proxy appends the address it saw to X-Forwarded-For,
 * so entries a visitor typed themselves are always on the left. Reading from the right:
 * - straight to Cloud Run, the last entry is the visitor;
 * - through our load balancer, the last entry is the load balancer and the one before is the visitor.
 * `proxies` lists the addresses of our own proxies, which are skipped.
 */
export function visitorOf(request: Request, proxies: string[] = []): string {
  const hops = forwardedHops(request)
  while (hops.length > 0 && proxies.includes(hops[hops.length - 1])) hops.pop()
  return hops.at(-1) || 'unknown'
}

/**
 * The header a page sends with a random id for its browser (src/lib/browserId.ts). It is not a
 * secret and not personal: the page makes it up, keeps it in localStorage, and anyone can send any
 * value. It only splits one address among the browsers behind it.
 */
export const BROWSER_HEADER = 'x-sightline-browser'
const BROWSER_ID = /^[A-Za-z0-9_-]{16,64}$/

/** The page's browser id, or null when the header is missing or isn't shaped as a page makes it. */
export function browserOf(request: Request): string | null {
  const id = request.headers.get(BROWSER_HEADER)?.trim() ?? ''
  return BROWSER_ID.test(id) ? id : null
}

/**
 * Who a request counts against, for rate limits. `address` is the visitor's network address, as
 * `visitorOf` reads it. `visitor` is that address and the page's browser id together, so people who
 * share one address (a venue's Wi-Fi, an office, a phone carrier's NAT) each get their own allowance;
 * without an id it is the address alone, as before the header existed. The id is the visitor's own
 * claim, so whatever is counted per `visitor` must also be capped per `address`.
 */
export function visitorKeys(request: Request, proxies: string[] = []): { address: string; visitor: string } {
  const address = visitorOf(request, proxies)
  const browser = browserOf(request)
  return { address, visitor: browser ? `${address}~${browser}` : address }
}

/** The addresses in X-Forwarded-For, in the order the proxies added them. */
export function forwardedHops(request: Request): string[] {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  return forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)
}
