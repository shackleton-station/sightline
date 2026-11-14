import { OLD_HOME } from './siteTabs'

/**
 * Sightline is the front page. Before it, "/" was the Whole Moon page and two designs of the site
 * page (Classic, and Mission control with ?ui=next), and it also opened How it works, the demo
 * video, the tour, shared plans and "Follow the presenter". Every such address still answers: this
 * says where each one goes. An address with a match in Sightline opens that state; one with none
 * opens the page it always did, which now lives at /classic/.
 */
/** What to do with the address the front page was opened at. */
export type OldAddress =
  /** Nothing: it is Sightline's own, or the bare front page. */
  | { kind: 'stay' }
  /** Open Sightline on this address instead: the same site, hour and limits, in Sightline's own link. */
  | { kind: 'rewrite'; to: string }
  /** Open Sightline with How it works on show. */
  | { kind: 'how' }
  /** No match in Sightline: go to the old page. */
  | { kind: 'leave'; to: string }

const HOUR_MS = 3_600_000

/**
 * A second site in an old link (`b=site@YYYY-MM`, the Classic page's comparison) as a Sightline
 * scenario: the same hour of its own month, written as a shortlist entry (`site@YYYY-MM-DDTHH`).
 * Null if it is not a site and a month.
 */
function comparisonAsEntry(b: string, index: number): string | null {
  const match = /^(.+)@(\d{4})-(\d{2})$/.exec(b)
  if (!match) return null
  const start = Date.UTC(Number(match[2]), Number(match[3]) - 1, 1)
  const end = Date.UTC(Number(match[2]), Number(match[3]), 1)
  const at = Math.min(start + Math.max(index, 0) * HOUR_MS, end - HOUR_MS)
  return `${match[1]}@${new Date(at).toISOString().slice(0, 13)}`
}

/** Where an address opened at the front page goes. `pathname` is "/" there; anything else stays as it is. */
export function forwardOldAddress(at: { pathname: string; search: string; hash: string }): OldAddress {
  if (at.pathname !== '/' && at.pathname !== '/index.html') return { kind: 'stay' }
  const search = new URLSearchParams(at.search)
  const hash = at.hash === '#' ? '' : at.hash
  // Following a presenter, the demo video and the tour have no match in Sightline.
  if (search.has('follow') || hash === '#demo' || hash === '#tour') return { kind: 'leave', to: `${OLD_HOME}${at.search}${hash}` }
  // A saved plan opens here: Sightline fetches it and shows its view (sightline/usePlanLink.ts).
  if (hash.startsWith('#plan=')) return { kind: 'stay' }
  if (hash === '#how') return { kind: 'how' }
  if (!hash.startsWith('#a=')) return search.has('ui') ? { kind: 'rewrite', to: '/' } : { kind: 'stay' }

  // A site page's link, from Classic or Mission control: Sightline reads the same format. What it
  // does not read is dropped (the design, the 3D switch), and a comparison becomes a second scenario.
  const params = new URLSearchParams(hash.slice(1))
  const b = params.get('b')
  const entry = b ? comparisonAsEntry(b, Number(params.get('t') ?? 0)) : null
  const parts = hash
    .slice(1)
    .split('&')
    .filter((part) => !/^(b|view)=/.test(part))
    .map((part) => (entry && part.startsWith('list=') ? `list=${entry}~${part.slice(5)}` : part))
  if (entry && !parts.some((part) => part.startsWith('list='))) parts.push(`list=${entry}`)
  const to = `/#${parts.join('&')}`
  return to === `/${at.search}${hash}` ? { kind: 'stay' } : { kind: 'rewrite', to }
}
