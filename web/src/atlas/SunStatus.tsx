import { EarthIcon, EarthOffIcon, MoonIcon, SunHorizonIcon, SunIcon } from './icons'
import { SUN_WORDS, type SunState } from './looks'

interface Props {
  sun: SunState
  earth: boolean
  /** Whose hour this is: the site's name, or "This spot". */
  of: string
}

const SUN_ICONS = { sun: SunIcon, horizon: SunHorizonIcon, shadow: MoonIcon }

/** What is in view at the hour shown, as two chips: a sun, half sun or moon, and Earth or not. */
export function SunStatus({ sun, earth, of }: Props) {
  const Sun = SUN_ICONS[sun]
  return (
    // Not a live region: while the month plays it changes every few frames, and would talk over everything.
    <p className="atlas-status">
      <span className="atlas-status-of">{of}</span>
      <span className={`atlas-chip chip-${sun}`}>
        <Sun size={16} />
        {SUN_WORDS[sun]}
      </span>
      <span className={earth ? 'atlas-chip chip-earth' : 'atlas-chip chip-earth-off'}>
        {earth ? <EarthIcon size={16} /> : <EarthOffIcon size={16} />}
        {earth ? 'Earth in view' : 'Earth below the horizon'}
      </span>
    </p>
  )
}
