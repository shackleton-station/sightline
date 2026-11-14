import type { TrackPoint } from '../data/contract'
import { csvFileName, trackCsv } from '../lib/csv'

interface Props {
  siteId: string
  month: string
  track: TrackPoint[]
}

/** Saves the month's hourly Sun and Earth data as a CSV file, straight from what the page shows. */
export function DownloadCsv({ siteId, month, track }: Props) {
  const save = () => {
    const blob = new Blob([trackCsv(track)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = csvFileName(siteId, month)
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <p className="actions">
      <button type="button" onClick={save} disabled={track.length === 0}>
        Download this month's hourly data (CSV)
      </button>
    </p>
  )
}
