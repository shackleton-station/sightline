import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SiteTabs } from '../components/SiteTabs'
import type { SiteInfo } from '../data/contract'
import { loadSites, type ScenarioData } from '../data/loadSite'
import { useScenario } from '../data/useScenario'
import { useSiteFlagsState } from '../data/useSiteFlags'
import { setAddressBar } from '../lib/address'
import { monthLabel } from '../lib/months'
import { DEFAULT_VIEW } from '../lib/siteTabs'
import type { BodyRadii } from '../lib/surfaceView'
import { parseCustomSite } from '../lib/urlState'
import { TimeRiver } from '../shell/TimeRiver'
import { AnswerLine } from './AnswerLine'
import { useRange } from '../data/useRange'
import { nowIso } from '../sightline/hooks'
import { atNearestHour, readAddress, SURFACE_MOVED, type SurfaceAddress, type SurfaceMoved, viewLink } from './address'
import { Pickers } from './Pickers'
import { Notice, Waiting } from './SurfaceStates'
import { SurfaceStage } from './SurfaceStage'
import { useBodySizes } from './useBodySizes'
import { readTintLink, useGroundTint } from './useGroundTint'

const FALLBACK = readAddress(DEFAULT_VIEW) as SurfaceAddress
const ADDRESS_SETTLED_MS = 250
/** While the view keeps moving (time playing, a long turn), the address is still rewritten this often, so someone following a presenter keeps up. */
const ADDRESS_AT_LEAST_EVERY_MS = 500

/** True when this page is shown inside another one (Sightline's Surface mode), which has its own tabs and its own way to choose the site and date. */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // A parent on another origin can't be read: still a frame.
    return true
  }
}
const EMBEDDED = isEmbedded()

/**
 * The Surface tab: the visitor stands at the site, 2 m up, and looks around at the horizon the
 * pipeline computed, with the Sun and Earth where its track puts them for the hour on the time
 * river, in two views: one that follows the Sun and one that follows Earth. The site, month and hour
 * live here, and in the address. Inside Sightline the site and month menus are left out: its side
 * panel chooses them, and both views follow through the address.
 */
export function SurfaceApp() {
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [sitesFailed, setSitesFailed] = useState(false)
  // With no link, the page opens on the whole hour nearest now (UTC), on the default site.
  const [address, setAddress] = useState<SurfaceAddress>(() => readAddress(window.location.hash) ?? atNearestHour(FALLBACK, nowIso()))
  const openedOnNow = useRef(readAddress(window.location.hash) === null)
  const range = useRange()
  // If now is outside the years the data holds, it opens on the default view instead.
  useEffect(() => {
    if (!range || !openedOnNow.current) return
    openedOnNow.current = false
    const now = Date.parse(nowIso())
    if (now < Date.parse(range.start) || now >= Date.parse(range.end) - 1_800_000) setAddress(FALLBACK)
  }, [range])
  /** The link the visitor arrived with, when it names a place this tab can't show. */
  const [arrivedAt, setArrivedAt] = useState(() => window.location.hash)
  // The "Mission success probability" layer, when the link asks for it: Sightline's Surface view does.
  const [tintLink, setTintLink] = useState(() => readTintLink(window.location.hash))

  useEffect(() => {
    loadSites().then(setSites).catch(() => setSitesFailed(true))
  }, [])

  // Following a link in the open tab (or another feature rewriting the address) moves the view, with no reload.
  useEffect(() => {
    const onHashChange = () => {
      const to = readAddress(window.location.hash)
      if (!to) return
      setTintLink(readTintLink(window.location.hash))
      setAddress(to)
      setArrivedAt(window.location.hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Custom coordinates and sites that aren't listed open the first listed site, and the page says so.
  const listed = sites.find((candidate) => candidate.id === address.site) ?? null
  const site = listed ?? sites[0] ?? null
  const loaded = useScenario(site, address.month)
  const sizes = useBodySizes(loaded.data?.site ?? null, loaded.data?.track ?? null)
  // What is on screen: the last site and month to have arrived whole, with the disks' sizes. It
  // stays up while another loads, so the visitor keeps their place and the way they face.
  const [scene, setScene] = useState<{ data: ScenarioData; radii: BodyRadii[] } | null>(null)
  if (loaded.data && sizes.radii && (scene?.data !== loaded.data || scene.radii !== sizes.radii)) {
    setScene({ data: loaded.data, radii: sizes.radii })
  }
  const data = scene?.data ?? null
  const { error } = loaded
  const { flags, failed: flagsFailed } = useSiteFlagsState(data?.site ?? null)
  const groundTint = useGroundTint(tintLink, data?.site ?? null, data?.horizon ?? null)
  const index = data ? Math.min(address.index, data.track.length - 1) : 0
  const pending = site !== null && data !== null && (data.site.id !== site.id || data.month !== address.month)

  // The address reopens what is on screen; the tabs open the other designs on the same view.
  const shown = useMemo<SurfaceAddress>(() => ({ ...address, site: site?.id ?? address.site, index }), [address, site, index])
  const link = site ? viewLink(shown) : ''
  /** When the view first moved away from what the address says; null while the address is up to date. */
  const movedAt = useRef<number | null>(null)
  useEffect(() => {
    if (!link) return
    // Not on every hour of a played month: browsers limit how often the address may be rewritten.
    // Once the view has settled, or twice a second while it keeps moving.
    movedAt.current ??= performance.now()
    const wait = Math.min(ADDRESS_SETTLED_MS, Math.max(0, movedAt.current + ADDRESS_AT_LEAST_EVERY_MS - performance.now()))
    const timer = setTimeout(() => {
      movedAt.current = null
      setAddressBar(link)
      // Inside Sightline, its side panel follows the month and hour chosen here.
      if (EMBEDDED) window.parent.postMessage({ type: SURFACE_MOVED, site: shown.site, month: shown.month, index: shown.index } satisfies SurfaceMoved, window.location.origin)
    }, wait)
    return () => clearTimeout(timer)
  }, [link])

  const setIndex = useCallback((next: number) => setAddress((current) => ({ ...current, index: next })), [])
  const choose = useCallback((siteId: string) => {
    setAddress((current) => ({ ...current, site: siteId }))
    setArrivedAt('')
  }, [])
  const setMonth = useCallback((month: string) => setAddress((current) => ({ ...current, month, index: 0 })), [])

  const months = data ? data.year.months.map((row) => row.month) : [address.month]
  const monthStep = (by: number) => {
    const to = months[months.indexOf(address.month) + by]
    return { label: to ? monthLabel(to).split(' ')[0] : '', onClick: to ? () => setMonth(to) : null }
  }

  const pickers = EMBEDDED ? null : <Pickers sites={sites} siteId={site?.id ?? ''} month={address.month} months={months} onSite={choose} onMonth={setMonth} />
  const custom = parseCustomSite(readAddress(arrivedAt)?.site ?? '')
  const unlisted = site !== null && listed === null && arrivedAt !== ''

  return (
    <div className={EMBEDDED ? 'surface is-embedded' : 'surface'}>
      {!EMBEDDED && <SiteTabs current="surface" view={site ? viewLink(shown) : ''} />}
      {unlisted && site && <Notice site={site} custom={custom} link={arrivedAt} onClose={() => setArrivedAt('')} />}
      <main className="sf-main">
        {sitesFailed ? (
          <Waiting problem="The list of sites could not be loaded." />
        ) : error && (!data || pending) ? (
          <div className="sf-view">
            {pickers}
            <Waiting problem={`${site?.name ?? 'This site'} in ${monthLabel(address.month)} could not be loaded.`} />
          </div>
        ) : sizes.failed && (!data || pending) ? (
          <Waiting problem="The Sun’s and Earth’s distances, which set how big they are drawn, could not be loaded." onRetry={sizes.retry} />
        ) : !site || !scene || !data ? (
          <Waiting loading={site ? `Loading the horizon at ${site.name}…` : 'Loading the sites…'} />
        ) : (
          <SurfaceStage
            site={data.site}
            month={data.month}
            horizon={data.horizon}
            groundTint={groundTint}
            track={data.track}
            index={index}
            radii={scene.radii}
            obsHeightM={data.summary.obs_height_m}
            pickers={pickers}
            answer={
              <AnswerLine
                siteName={data.site.name}
                now={data.track[index]}
                summary={data.summary}
                flags={flags}
                flagsFailed={flagsFailed}
                lastYear={data.year.years[data.year.years.length - 1].year}
              />
            }
          />
        )}
        {pending && !error && <p className="sf-pending">Loading {site?.name}, {monthLabel(address.month)}…</p>}
      </main>
      {data && (
        <footer className="sf-river">
          <TimeRiver track={data.track} index={index} onIndex={setIndex} previous={monthStep(-1)} next={monthStep(1)} />
        </footer>
      )}
    </div>
  )
}
