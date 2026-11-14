/** The Atlas tour: five steps, each pointing at a part of the page marked with `data-tour`. */
export interface TourStep {
  /** The `data-tour` value of what the step points at; null for the welcome, which points at nothing. */
  target: string | null
  title: string
  body: string
}

export const TOUR: TourStep[] = [
  {
    target: null,
    title: 'Welcome to the Atlas',
    body: 'See where sunlight and Earth reach the Moon’s south pole, hour by hour. The light on the ground is our own pipeline’s answer, from NASA terrain and ephemeris data. Five quick steps.',
  },
  {
    target: 'place',
    title: 'Pick a place',
    body: 'Choose a landing site and a month. The chips say what is in view this hour: a sun when the Sun is up, a half sun when it sits on the horizon, a moon when terrain hides it, and whether Earth is up for a radio link.',
  },
  {
    target: 'layers',
    title: 'Choose what the ground shows',
    body: 'Open this menu to color the pole by sunlight this hour, Sun and Earth together, or the month’s share of sunlight. The key for each one is in the same panel.',
  },
  {
    target: 'time',
    title: 'Move through the month',
    body: 'Press play or drag the bar. It has two lanes for the month at this place: the top one is gold while the Sun is up, the bottom one blue while Earth is up. Dark means hidden. Arrow keys step one hour. All times are UTC.',
  },
  {
    target: 'scout',
    title: 'Ask Scout',
    body: 'Scout is our AI guide. Tap the ground for its month, or ask about a site, the data or how we checked it. Answers are AI-generated, so look for the source it names.',
  },
]

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Where the step's card goes: under the target when there is room, otherwise above it, inside the window. */
export function cardPlace(target: Box | null, view: { width: number; height: number }, card: { width: number; height: number }, gap = 16): { left: number; top: number } {
  const margin = 16
  const clampLeft = (left: number) => Math.min(Math.max(left, margin), Math.max(margin, view.width - card.width - margin))
  if (!target) return { left: clampLeft((view.width - card.width) / 2), top: Math.max(margin, (view.height - card.height) / 2) }
  const left = clampLeft(target.left + target.width / 2 - card.width / 2)
  const below = target.top + target.height + gap
  if (below + card.height <= view.height - margin) return { left, top: below }
  const above = target.top - gap - card.height
  return { left, top: Math.max(margin, above) }
}

const SEEN = 'atlas-tour-seen'

/** Whether this browser has seen the tour (false when storage is blocked, so the tour shows). */
export function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN) === '1'
  } catch {
    return false
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(SEEN, '1')
  } catch {
    // Storage blocked (private window): the tour shows again next time, which is fine.
  }
}
