import { withYourTime } from '../lib/yourTime'
import { useRef, useState } from 'react'

interface Props {
  /** "6 May 2027 · 13:00 UTC": the landing as the app writes it. */
  landing: string
  /** The landing as a date field holds it, "2027-05-06T13:00" (UTC), and the first and last hours in the data. */
  landingField: string
  firstField: string
  lastField: string
  /** A date and hour were chosen, as "YYYY-MM-DDTHH:00"; returns false if it isn't a moment in the data. */
  onPick: (value: string) => boolean
}

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))

/** Opens a date field's calendar, where the browser has one to open. */
function openCalendar(input: HTMLInputElement) {
  try {
    input.showPicker()
  } catch {
    // Some browsers open their picker only from a direct tap on the field, which this press also is.
  }
}

/**
 * The landing's date and hour as one control. What the visitor sees is the landing as the app writes
 * it; under the date lies the browser's date field and under the hour a list of the 24 whole hours,
 * both unseen, so a press on either part opens the right picker. The data is hourly, so there are no
 * minutes to choose: the hour is always a whole hour, in UTC.
 */
export function LandingPick({ landing, landingField, firstField, lastField, onPick }: Props) {
  const [date, time] = landing.split(' · ')
  const dateInput = useRef<HTMLInputElement>(null)
  const hourSelect = useRef<HTMLSelectElement>(null)
  // While a year is being typed the field holds dates like 0002-05-06, which aren't in the data:
  // keep what is typed, and move the landing only once the date is one the data covers.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div className="sl-pick" data-tip-tap title={`${withYourTime(time, Date.parse(`${landingField}:00Z`))}. Choose the landing's date and hour (UTC).`}>
      <span className="sl-pick-part">
        <span className="sl-value">{date}</span>
        <input
          ref={dateInput}
          type="date"
          aria-label="Landing date (UTC)"
          min={firstField.slice(0, 10)}
          max={lastField.slice(0, 10)}
          value={draft ?? landingField.slice(0, 10)}
          onChange={(event) => {
            setDraft(event.target.value)
            // The hour comes from the list as it stands, so a date and an hour chosen one after the other both count.
            onPick(`${event.target.value}T${hourSelect.current?.value ?? landingField.slice(11, 13)}:00`)
          }}
          onBlur={() => setDraft(null)}
          onClick={(event) => openCalendar(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            openCalendar(event.currentTarget)
          }}
        />
      </span>
      <span className="sl-value" aria-hidden="true">
        {' · '}
      </span>
      <span className="sl-pick-part">
        <span className="sl-value">{time}</span>
        <select
          ref={hourSelect}
          aria-label="Landing hour (UTC)"
          value={landingField.slice(11, 13)}
          onChange={(event) => onPick(`${dateInput.current?.value || landingField.slice(0, 10)}T${event.target.value}:00`)}
        >
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {hour}:00
            </option>
          ))}
        </select>
      </span>
    </div>
  )
}
