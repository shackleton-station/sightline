import { OLD_HOME } from '../lib/siteTabs'
import type { SiteInfo } from '../data/contract'

interface WaitingProps {
  /** What is loading, in words. */
  loading?: string
  /** What went wrong, in words. */
  problem?: string
  /** A way to try the failed part again without losing the page; otherwise the page is reloaded. */
  onRetry?: () => void
}

/** The picture's place while it loads, or when it can't: a horizon line and a sentence. */
export function Waiting({ loading, problem, onRetry }: WaitingProps) {
  return (
    <div className={problem ? 'sf-wait problem' : 'sf-wait'} role={problem ? 'alert' : 'status'}>
      <span className="sf-wait-line" aria-hidden="true" />
      <p>{problem ?? loading}</p>
      {problem && (
        <button type="button" onClick={onRetry ?? (() => window.location.reload())}>
          {onRetry ? 'Try again' : 'Reload the page'}
        </button>
      )}
    </div>
  )
}

interface NoticeProps {
  /** The listed site shown instead. */
  site: SiteInfo
  /** The point the link named, if it was custom coordinates. */
  custom: { lat: number; lon: number } | null
  /** The link as it arrived, to open on a tab that can show it. */
  link: string
  onClose: () => void
}

const degrees = (value: number, positive: string, negative: string) => `${Math.abs(value).toFixed(2)}° ${value < 0 ? negative : positive}`

/**
 * Said when a link names a place this tab can't stand on. The view from the ground needs a site's
 * computed horizon and track files, which exist for the listed sites; a point of the visitor's own
 * is worked out in the browser on the Classic tab.
 */
export function Notice({ site, custom, link, onClose }: NoticeProps) {
  return (
    <p className="sf-notice" role="status">
      {custom ? (
        <>
          This tab stands on the listed sites only. Your link is for a point of your own ({degrees(custom.lat, 'N', 'S')}, {degrees(custom.lon, 'E', 'W')}), so this is{' '}
          {site.name} instead. <a href={`${OLD_HOME}${link}`}>Open your point in Classic</a>
        </>
      ) : (
        <>Your link names a site that is not in the list, so this is {site.name} instead.</>
      )}
      <button type="button" aria-label="Close this note" onClick={onClose}>
        ×
      </button>
    </p>
  )
}
