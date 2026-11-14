import { describe, expect, it } from 'vitest'
import { withYourTime, yourStretch, yourTime } from './yourTime'

const at = (iso: string) => Date.parse(iso)

describe("a time in the visitor's own zone, for the hover text", () => {
  it('follows daylight saving: the same UTC hour is an hour apart in summer and winter', () => {
    expect(yourTime(at('2027-05-06T10:00:00Z'), 'America/New_York')).toBe('6:00 am your time (EDT)')
    expect(yourTime(at('2027-01-15T10:00:00Z'), 'America/New_York')).toBe('5:00 am your time (EST)')
  })

  it('handles a zone half an hour off', () => {
    expect(yourTime(at('2027-05-06T10:00:00Z'), 'Asia/Kolkata')).toBe('3:30 pm your time (GMT+5:30)')
  })

  it('says the date when it is not the UTC date, on either side of midnight', () => {
    expect(yourTime(at('2027-05-06T02:00:00Z'), 'America/New_York')).toBe('5 May, 10:00 pm your time (EDT)')
    expect(yourTime(at('2027-05-06T20:00:00Z'), 'Asia/Tokyo')).toBe('7 May, 5:00 am your time (GMT+9)')
    // Across a new year too.
    expect(yourTime(at('2028-01-01T03:00:00Z'), 'America/Los_Angeles')).toBe('31 December, 7:00 pm your time (PST)')
  })

  it('writes the UTC time first, as the screen shows it, then the visitor\'s', () => {
    expect(withYourTime('10:00 UTC', at('2027-05-06T10:00:00Z'), 'America/New_York')).toBe('10:00 UTC · 6:00 am your time (EDT)')
    expect(withYourTime('10:00 UTC', at('2027-05-06T10:00:00Z'), 'UTC')).toBe('10:00 UTC · 10:00 am your time (UTC)')
  })

  it('writes a stretch with a date at each end, and both zones when the clocks change inside it', () => {
    expect(yourStretch(at('2027-05-06T13:00:00Z'), at('2027-05-09T02:00:00Z'), 'America/New_York')).toBe('6 May, 9:00 am to 8 May, 10:00 pm your time (EDT)')
    // The United States puts its clocks back on 7 November 2027.
    expect(yourStretch(at('2027-11-06T13:00:00Z'), at('2027-11-08T13:00:00Z'), 'America/New_York')).toBe('6 November, 9:00 am (EDT) to 8 November, 8:00 am (EST) your time')
  })
})
