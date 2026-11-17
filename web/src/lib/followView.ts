import { TREK_LAYERS, type TrekLayerId } from './trekLayers'

/**
 * "Follow the presenter" on the Sightline screen.
 *
 * Followers go where the presenter's address goes (lib/followClient.ts). The Sightline screen's
 * address holds the plan: its scenarios, the mission, the skyline strip and the Planner's tab. It
 * does not hold what a room also needs to see together: the hour on the time bar, whether time is
 * playing, how close the Moon is seen, the side panel, a map laid over the ground, a sheet that is
 * open. While a tab is presenting, and only then, the screen adds those to its address, after
 * everything else. This file writes them and reads them back; every value is checked on the way in,
 * since a follower's page takes them from a stranger's room.
 *
 * Watch has no plan in its address, so a presenter's Watch is "#watch=1" and then the same values.
 */
export interface Followed {
  /** The hour on the time bar, as a whole UTC hour ("2027-05-06T13:00:00Z"); null if the address names none. */
  barIso: string | null
  /** Hours of ephemeris a second while time plays; null while it is held. */
  play: number | null
  /** How close the Moon is seen. */
  stage: 'orbit' | 'site' | 'surface'
  /** The side panel that is open. Scout's is left out: his conversation is each visitor's own. */
  panel: FollowedPanel | null
  /** The Library, which takes the Planner's place in the full view. */
  library: boolean
  /** A sheet over the screen: the written brief, or the Guide. */
  sheet: 'brief' | 'guide' | null
  /** The NASA map laid over the ground, and the app's own light and shadow. */
  layer: TrekLayerId | null
  light: boolean
}

export const FOLLOWED_PANELS = ['compare', 'layers', 'rover', 'accuracy'] as const
export type FollowedPanel = (typeof FOLLOWED_PANELS)[number]

/** The speeds a follower's clock may be set to: no slower than an hour a second, no faster than a month. */
const MIN_PLAY = 1
const MAX_PLAY = 24 * 31
const BAR = /^\d{4}-\d{2}-\d{2}T\d{2}$/
const WATCH = '#watch=1'

/** The values a presenter's screen adds to its address, each only when it is not the screen's resting state. */
export function followedPart(shown: Followed): string {
  return [
    shown.barIso ? `&bar=${shown.barIso.slice(0, 13)}` : '',
    shown.play !== null ? `&play=${shown.play}` : '',
    shown.stage !== 'orbit' ? `&stage=${shown.stage}` : '',
    shown.panel ? `&fpanel=${shown.panel}` : '',
    shown.library ? '&lib=1' : '',
    shown.sheet ? `&sheet=${shown.sheet}` : '',
    shown.layer ? `&layer=${shown.layer}` : '',
    shown.light ? '&light=1' : '',
  ].join('')
}

/** A presenter's address: the plan's own link (null in Watch) and then what a room also sees, as `followedPart` wrote it. */
export function presenterHash(planLink: string | null, part: string): string {
  return `${planLink ?? WATCH}${part}`
}

/** Whether an address is a presenter's Watch: the Moon alone, with no plan. */
export function isWatchHash(hash: string): boolean {
  return hash === WATCH || hash.startsWith(`${WATCH}&`)
}

/** What a presenter's address says beside the plan. Anything missing or not understood is the screen's resting state. */
export function readFollowed(hash: string): Followed {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const oneOf = <T extends string>(name: string, values: readonly T[]): T | null => {
    const value = params.get(name)
    return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null
  }
  const bar = params.get('bar')
  const play = Number(params.get('play'))
  return {
    barIso: bar !== null && BAR.test(bar) && Number.isFinite(Date.parse(`${bar}:00:00Z`)) ? `${bar}:00:00Z` : null,
    play: params.has('play') && Number.isFinite(play) && play >= MIN_PLAY && play <= MAX_PLAY ? play : null,
    stage: oneOf('stage', ['site', 'surface'] as const) ?? 'orbit',
    panel: oneOf('fpanel', FOLLOWED_PANELS),
    library: params.get('lib') === '1',
    sheet: oneOf('sheet', ['brief', 'guide'] as const),
    layer: oneOf(
      'layer',
      TREK_LAYERS.map((layer) => layer.id),
    ),
    light: params.get('light') === '1',
  }
}

/**
 * Whether a follower's clock is moved to the presenter's hour. Held, always: the two screens then
 * show the same hour. While both play at one speed the follower's clock runs by itself, and is only
 * set again when it has drifted by more than a few seconds of play, so its Moon does not twitch
 * each time the presenter's page says where it is.
 */
export function shouldSetHour(mine: number, theirs: number, play: number | null, wasPlaying: boolean, driftSeconds = 3): boolean {
  if (play === null || !wasPlaying) return true
  return Math.abs(mine - theirs) > play * driftSeconds
}
