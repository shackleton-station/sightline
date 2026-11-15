/**
 * Which sites the Moon rings for a reply of Scout's: the ones his first sentence names, so the Moon
 * shows what the answer leads with and never a site named further down. A reply whose first
 * sentence names no listed site falls back to the site its first button opens, then to the first
 * site named anywhere in it.
 */

interface Named {
  id: string
  name: string
}

/** The first sentence of a text: up to the first full stop, question mark or exclamation mark that ends a sentence (a decimal point, as in "0.5°", does not). */
export function firstSentence(text: string): string {
  for (let i = 0; i < text.length; i += 1) {
    if (!'.!?'.includes(text[i])) continue
    const next = text[i + 1]
    if (next !== undefined && !/\s/.test(next)) continue
    return text.slice(0, i + 1)
  }
  return text
}

/** The listed sites a piece of text names, in the order it names them, each once. A name counts only as a whole name: "Apollo 1" is not found in "Apollo 11". */
export function sitesNamedIn(text: string, sites: Named[]): string[] {
  const found: { id: string; at: number }[] = []
  for (const site of sites) {
    let from = 0
    while (from <= text.length) {
      const at = text.indexOf(site.name, from)
      if (at < 0) break
      const before = text[at - 1]
      const after = text[at + site.name.length]
      const whole = (before === undefined || !/[\p{L}\p{N}]/u.test(before)) && (after === undefined || !/[\p{L}\p{N}]/u.test(after))
      if (whole) {
        found.push({ id: site.id, at })
        break
      }
      from = at + 1
    }
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.id)
}

/** The sites to ring for a reply. `linkedSite` reads the site a button's link opens, or null. */
export function ringedSites(reply: { text: string; actions?: { hash: string }[] }, sites: Named[], linkedSite: (hash: string) => string | null): string[] {
  const leading = sitesNamedIn(firstSentence(reply.text), sites)
  if (leading.length > 0) return leading
  const linked = reply.actions?.[0] ? linkedSite(reply.actions[0].hash) : null
  if (linked && sites.some((site) => site.id === linked)) return [linked]
  return sitesNamedIn(reply.text, sites).slice(0, 1)
}
