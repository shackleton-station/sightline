const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "May" from "2027-05". */
export function monthName(month: string): string {
  return NAMES[Number(month.slice(5, 7)) - 1]
}

/** "May 2027" from "2027-05". */
export function monthLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`
}
