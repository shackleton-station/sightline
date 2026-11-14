import { useState } from 'react'

interface Props {
  /** The time on show, as "YYYY-MM-DDTHH:MM". */
  value: string
  min: string
  max: string
  /** Called with each complete date; returns false if it's outside the data. */
  onPick: (value: string) => boolean
}

/**
 * A date and hour. While someone types a year, the field holds values like 0002, which aren't dates
 * we have, so it keeps what's typed and only moves the page once a date is usable.
 */
export function DateField({ value, min, max, onPick }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="date-pick">
      Date (UTC)
      <input
        type="datetime-local"
        step={3600}
        min={min}
        max={max}
        value={draft ?? value}
        onChange={(event) => {
          setDraft(event.target.value)
          onPick(event.target.value)
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}
