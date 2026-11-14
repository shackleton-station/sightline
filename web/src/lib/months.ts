const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "May" from "2027-05". */
export function monthName(month: string): string {
  return NAMES[Number(month.slice(5, 7)) - 1]
}

/** "May 2027" from "2027-05". */
export function monthLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`
}

const LONG_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "January" from "2027-01": the month in full, for a sentence. */
export function monthLong(month: string): string {
  return LONG_NAMES[Number(month.slice(5, 7)) - 1]
}
