import { forwardOldAddress } from '../lib/oldAddress'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataRange, SiteInfo } from '../data/contract'
import { loadRange, loadSiteFlags, loadSites } from '../data/loadSite'
import type { FlaggedSite } from '../data/useAllFlags'
import { spanFor, spanToReach, type YearSpan, yearsInHash } from '../lib/span'
import { nowIso } from './hooks'
import { Sightline } from './Sightline'

/**
 * Sightline: where to land on the Moon, and when. Loads the site list, what span of time the data
 * covers and the hourly flags, then shows the one screen.
 *
 * The data covers decades, and the screen opens on a few years of it: those around the dates in its
 * link, or around the data's default month. Opening therefore costs the same however long the
 * range is. When a date outside those years is picked, pasted or played into, the years are fetched
 * then: the ones just ahead are added to those on hand, and a date far off starts the screen again
 * around it, on its link, so the hours it counts never grow without bound.
 */
export function SightlineApp() {
  // This screen is the front page. An address that used to open another page there is forwarded
  // before anything is loaded: to the matching state of this screen (the same site, hour and
  // limits; How it works), or to the old page where there is none (lib/oldAddress.ts).
  const [moved] = useState(() => {
    const to = forwardOldAddress(window.location)
    if (to.kind === 'rewrite') window.history.replaceState(null, '', to.to)
    if (to.kind === 'leave') window.location.replace(to.to)
    return to
  })
  const leaving = moved.kind === 'leave'
  const openHow = moved.kind === 'how'
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [range, setRange] = useState<DataRange | null>(null)
  const [failed, setFailed] = useState(false)
  // The years asked for, and the years on show: the last that finished loading.
  const [span, setSpan] = useState<YearSpan | null>(null)
  const [shown, setShown] = useState<{ span: YearSpan; flagged: FlaggedSite[] } | null>(null)
  // The link a screen that starts again opens on.
  const jump = useRef<string | null>(null)

  useEffect(() => {
    if (leaving) return
    Promise.all([loadSites(), loadRange()])
      .then(([list, described]) => {
        setSites(list)
        setRange(described)
        // A link names its years. Without one the screen opens on now, so this year is the one to have.
        const named = yearsInHash(window.location.hash)
        setSpan(spanFor(named.length > 0 ? named : [Number(nowIso().slice(0, 4))], described))
      })
      .catch(() => setFailed(true))
  }, [leaving])

  useEffect(() => {
    if (!span || sites.length === 0) return
    let current = true
    Promise.all(sites.map(async (site) => ({ site, flags: await loadSiteFlags(site, span) })))
      .then((flagged) => {
        if (!current) return
        // The address first, so the screen that starts again reads its link from it.
        if (jump.current) window.history.replaceState(null, '', jump.current)
        jump.current = null
        setShown({ span, flagged })
      })
      .catch((reason: unknown) => {
        console.error(reason)
        if (!current) return
        jump.current = null
        // With years already on show the screen stays as it is; with none, say so.
        setShown((before) => {
          if (!before) setFailed(true)
          else setSpan(before.span)
          return before
        })
      })
    return () => {
      current = false
    }
  }, [sites, span])

  const need = useCallback(
    (years: number[], link?: string) => {
      if (!range || !span) return false
      const reach = spanToReach(span, years, range)
      // Without a link there is nowhere to start again: time playing on only ever adds the years ahead.
      if (!reach || (!reach.grown && !link)) return false
      const asked = reach.span.from === span.from && reach.span.to === span.to
      const arriving = !shown || shown.span.from !== span.from || shown.span.to !== span.to
      if (asked && !arriving) return false
      // A screen that is about to start again opens on the latest link asked for: a date, then its hour.
      if (!reach.grown || jump.current !== null) jump.current = link ?? jump.current
      if (!asked) setSpan(reach.span)
      return true
    },
    [range, span, shown],
  )

  if (!shown || !range || shown.flagged.length === 0) {
    return (
      <div className="scout sightline is-watch">
        <header className="sl-brand">
          <h1>Sightline</h1>
          <p>{failed ? "The site list didn't load. Try again in a moment." : 'Where to land on the Moon, and when'}</p>
        </header>
      </div>
    )
  }
  // Keyed by the first year on hand: clock hours count from it, so a screen can't outlive a change to it.
  return <Sightline key={shown.span.from} sites={sites} flagged={shown.flagged} range={range} onNeed={need} openHow={openHow} />
}
