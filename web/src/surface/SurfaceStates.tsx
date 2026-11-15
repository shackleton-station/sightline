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
  onClose: () => void
}

/**
 * Said when a link names a site that is not in the list. (A point of the visitor's own is stood on:
 * its skyline is worked out in the browser.)
 */
export function Notice({ site, onClose }: NoticeProps) {
  return (
    <p className="sf-notice" role="status">
      Your link names a site that is not in the list, so this is {site.name} instead.
      <button type="button" aria-label="Close this note" onClick={onClose}>
        ×
      </button>
    </p>
  )
}
