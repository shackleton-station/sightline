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

/** The addresses in X-Forwarded-For, in the order the proxies added them. */
export function forwardedHops(request: Request): string[] {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  return forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)
}
