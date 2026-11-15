import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { SiteInfo } from '../data/contract'
import type { RiverState } from '../lib/river'
import { STATE_WORDS } from '../lib/sightline'

/** One marker on the Moon: a single site's dot, or a group standing in for sites that would overlap. */
export interface Marker {
  key: string
  sites: SiteInfo[]
  /** Its place on the globe's square, in pixels. */
  x: number
  y: number
  /** The name printed under it, and whether there is room to print it. */
  text: string
  label: boolean
  /** Which side of the marker the name is on: under it unless a neighbour's dot is there. */
  labelSide?: 'below' | 'above' | 'right' | 'left'
  /** Whether the scenario's site is this marker, or in it. */
  selected: boolean
}

interface Props {
  markers: Marker[]
  /** The globe's square, in pixels across. */
  side: number
  states: Map<string, RiverState>
  onChoose: (site: SiteInfo) => void
  onPoint: (site: SiteInfo | null) => void
  /**
   * Sites whose marker is drawn as an open ring, with the ring's radius on screen: close on a site
   * whose picture is not tied to the marker's coordinates (lib/moonDetail.ts, `UNTIED_GAP_M`).
   */
  within?: { ids: ReadonlySet<string>; radiusPx: number } | null
}

const place = (marker: Marker, side: number) => ({ left: `${(marker.x / side) * 100}%`, top: `${(marker.y / side) * 100}%` })

/** The site markers on the Moon. */
export function Dots({ markers, side, states, onChoose, onPoint, within = null }: Props) {
  return markers.map((marker) =>
    marker.sites.length === 1 ? (
      <Dot key={marker.key} marker={marker} side={side} state={states.get(marker.sites[0].id)} onChoose={onChoose} onPoint={onPoint} ringPx={within?.ids.has(marker.sites[0].id) ? within.radiusPx : null} />
    ) : (
      <Group key={marker.key} marker={marker} side={side} states={states} onChoose={onChoose} />
    ),
  )
}

interface DotProps {
  marker: Marker
  side: number
  state: RiverState | undefined
  onChoose: (site: SiteInfo) => void
  onPoint: (site: SiteInfo | null) => void
  /** The radius of the open ring this marker is drawn as, in pixels; null for the usual dot. */
  ringPx: number | null
}

/** One site: its colour and shape say what is up there now, and so do its words. */
function Dot({ marker, side, state, onChoose, onPoint, ringPx }: DotProps) {
  const site = marker.sites[0]
  const where = ringPx === null ? '' : '. On this photo the marker may be up to about 50 m off.'
  const words = `${state ? `${site.name}: ${STATE_WORDS[state]}` : site.name}${where}`
  return (
    <button
      type="button"
      className={`map-dot sl-dot${state ? ` is-${state}` : ''}${marker.selected ? ' is-selected' : ''}${ringPx === null ? '' : ' is-within'}`}
      aria-current={marker.selected ? 'true' : undefined}
      style={ringPx === null ? place(marker, side) : { ...place(marker, side), ['--sl-within' as string]: `${ringPx.toFixed(1)}px` }}
      aria-label={words}
      title={words}
      onClick={() => onChoose(site)}
      onPointerEnter={() => onPoint(site)}
      onPointerLeave={() => onPoint(null)}
      onFocus={() => onPoint(site)}
      onBlur={() => onPoint(null)}
    >
      {/* Always there, and faded in or out, so a name never pops as the Moon turns. */}
      <span className={`at-${marker.labelSide ?? 'below'}${marker.label ? '' : ' off'}`}>{marker.text}</span>
      {ringPx !== null && <i className="sl-within" aria-hidden="true" />}
    </button>
  )
}

interface GroupProps {
  marker: Marker
  side: number
  states: Map<string, RiverState>
  onChoose: (site: SiteInfo) => void
}

/**
 * Sites too close to tell apart at this zoom, as one marker: the number of sites inside a ring in
 * their states' colours. Clicking or focusing it opens a list of them; picking one is the same as
 * picking its dot. Escape or a click elsewhere closes the list.
 */
function Group({ marker, side, states, onChoose }: GroupProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // An even slice of the ring for each site, in its state's colour.
  const slice = 360 / marker.sites.length
  const ring = `conic-gradient(${marker.sites.map((site, i) => `var(--sl-${states.get(site.id) ?? 'none'}) ${i * slice}deg ${(i + 1) * slice}deg`).join(', ')})`
  const names = marker.sites.map((site) => site.name).join(', ')

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      setOpen(false)
      opener.current?.focus()
    } else if (event.key === 'ArrowDown') items[Math.min(at + 1, items.length - 1)]?.focus()
    else if (event.key === 'ArrowUp') (at <= 0 ? opener.current : items[at - 1])?.focus()
    else return
    // These keys are the list's here, not the Moon's (which the arrows would otherwise turn).
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={box}
      className="sl-group"
      style={place(marker, side)}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={opener}
        type="button"
        className={marker.selected ? 'sl-group-dot is-selected' : 'sl-group-dot'}
        style={{ background: ring }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${marker.sites.length} sites close together: ${names}. Open the list.`}
        onClick={() => setOpen(true)}
        onFocus={(event) => {
          // Focus arriving from outside opens the list; coming back from the list itself (Escape, arrow up) does not.
          if (!(event.relatedTarget instanceof Node) || !box.current?.contains(event.relatedTarget)) setOpen(true)
        }}
      >
        <b>{marker.sites.length}</b>
        <span className={marker.label ? 'sl-group-label' : 'sl-group-label off'}>{marker.text}</span>
      </button>
      {open && (
        <div className="sl-group-list" role="menu" aria-label={`${marker.sites.length} sites here`}>
          {marker.sites.map((site) => {
            const state = states.get(site.id)
            return (
              <button
                key={site.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  // The pick is made: the list goes, so it does not stay open over the Moon.
                  setOpen(false)
                  onChoose(site)
                }}
              >
                <i className={`sl-swatch${state ? ` is-${state}` : ''}`} aria-hidden="true" />
                <span>
                  {site.name}
                  {state && <small>{STATE_WORDS[state]}</small>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
