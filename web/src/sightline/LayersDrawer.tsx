import { trekReachKm } from '../lib/layerReach'
import { type FinePhoto, TREK_LAYERS, type TrekLayerId, trekHalfWidthM, trekLayer } from '../lib/trekLayers'
import type { TrekOverlay } from './useTrekOverlay'

interface Props {
  /** Which Moon Trek maps hold the ground at the site on show: one that does not is greyed, with how far it reaches. */
  reach: Record<TrekLayerId, boolean>
  /** How far the app's light grid reaches from the pole, in km, from its own description; null until that has arrived. */
  lightKm: number | null
  /** The site on show, by name, for a greyed layer's hover text. */
  place: string
  /** The layer that is on, or none. */
  layer: TrekLayerId | null
  onLayer: (layer: TrekLayerId | null) => void
  state: TrekOverlay['state']
  /** Our own finer photo tiles round the ridge sites, once the photo is on and they are known; else null. */
  fine: FinePhoto | null
  /**
   * "Light and shadow", the app's own computed light: whether it is on, whether the light grid
   * reaches the site on show, what one cell of the grid covers (and one of the wider grid around
   * it), in meters, and whether the month's grid has arrived.
   */
  shade: { on: boolean; here: boolean; cellM: number | null; wideCellM: number | null; state: 'loading' | 'ready' | 'missing' }
  onShade: (on: boolean) => void
  /**
   * "Landing odds", the app's own: the odds that a lander aimed at each point comes down where the
   * mission fits, shaded on the Moon. Whether it is on, and whether the light grid reaches the site on show.
   */
  odds: { on: boolean; here: boolean }
  onOdds: (on: boolean) => void
  /** "Place names": the Moon's named places printed on it. Whether it is on, and whether its names have arrived. */
  names: { on: boolean; state: 'off' | 'loading' | 'ready' | 'failed' }
  onNames: (on: boolean) => void
  onClose: () => void
  /** Start the short guide to the views and layers; null while a guide is already on. */
  onShowHow: (() => void) | null
}

/**
 * Layers, in two groups. "Whole Moon": the place names, which change no view. "South pole, close
 * up": this app's own light and shadow and the mission's chance of success, and NASA's maps of the
 * ground from Moon Trek, laid over the Moon one at a time; each of these is seen close, so switching
 * one on goes to Site, and one that does not reach the site on show is greyed and says how far it
 * goes. Each map says how to read it, and the one that is on carries Trek's own title and credit.
 */
export function LayersDrawer({ reach, lightKm, place, layer, onLayer, state, fine, shade, onShade, odds, onOdds, names, onNames, onClose, onShowHow }: Props) {
  const on = trekLayer(layer)
  /** Why a ground layer is greyed at the site on show: how far it reaches from the pole, and that the site is beyond it. */
  const outside = (km: number | null, what: string) => (km === null ? `${what} covers the ground near the south pole. ${place} is outside it.` : `${what} reaches ${km} km from the south pole. ${place} is outside it.`)
  return (
    <aside className="sl-drawer sl-layers" aria-label="Layers">
      <header className="sl-drawer-head">
        <h2>Layers</h2>
        {onShowHow && (
          <button type="button" className="sl-link sl-show-how" onClick={onShowHow}>
            Show me how
          </button>
        )}
        <button type="button" className="sl-small" onClick={onClose}>
          Close
        </button>
      </header>
      {/* Two groups, so no switch is a dead end: what covers the whole Moon, and what is of the ground near the south pole and seen close. */}
      <h3 className="sl-layer-group">Whole Moon</h3>
      <ul className="sl-layer-own sl-layer-whole">
        <li>
          <label title="Prints the names of the Moon's large seas, craters, valleys and mountains, and of earlier landings, where they are: for finding your way around. Best seen with Orbit.">
            <input type="checkbox" role="switch" checked={names.on} onChange={() => onNames(!names.on)} />
            <span>Place names</span>
          </label>
        </li>
      </ul>
      {names.on && (
        <p className="sl-layer-shade sl-layer-credit sl-layer-names" role="status">
          {names.state === 'failed' ? (
            'The names could not be read. Switch the layer off and on to try again.'
          ) : (
            <>
              Names from the{' '}
              <a href="https://planetarynames.wr.usgs.gov/" target="_blank" rel="noreferrer">
                IAU Gazetteer of Planetary Nomenclature
              </a>
              ; earlier landings from NASA. Labels only: no number is worked out from them.
            </>
          )}
        </p>
      )}
      <h3 className="sl-layer-group">South pole, close up</h3>
      {/* A layer that does not reach the site on show is greyed and says how far it goes; one already on can still be switched off. */}
      <ul className="sl-layer-own sl-layer-ground">
        <li>
          <label title={shade.here ? 'Darkens the ground the Sun cannot reach at the hour on the time bar.' : outside(lightKm, 'This app’s light grid')}>
            <input type="checkbox" role="switch" checked={shade.on && shade.here} disabled={!shade.here} onChange={() => onShade(!shade.on)} />
            <span>Light and shadow</span>
          </label>
        </li>
        <li>
          <label title={odds.here || odds.on ? 'Colors the Moon by how likely a landing aimed there comes down where the mission fits. Green is likely, amber uncertain, red unlikely.' : outside(lightKm, 'The terrain this layer is worked out from')}>
            <input type="checkbox" role="switch" checked={odds.on} disabled={!odds.here && !odds.on} onChange={() => onOdds(!odds.on)} />
            <span>Mission success probability</span>
          </label>
        </li>
      </ul>
      {shade.on && shade.here && (
        <p className="sl-layer-shade" role="status">
          {shade.state === 'missing'
            ? 'The light grid has no data for this month.'
            : `Shadow from the terrain at the hour on the time bar, from this app’s hourly light grid.${shade.cellM ? ` One cell is ${shade.cellM} m of ground${shade.wideCellM ? `, ${shade.wideCellM} m farther from the pole` : ''}; edges are blended between cells.` : ''}`}
        </p>
      )}
      <p className="sl-quiet">NASA’s maps of the ground, from Moon Trek. One at a time; switching one on goes to Site, where it is seen close.</p>
      <ul className="sl-layer-list">
        {TREK_LAYERS.map((item) => (
          <li key={item.id}>
            <label title={reach[item.id] ? item.says : outside(trekReachKm(item), 'This map')}>
              <input type="checkbox" role="switch" checked={layer === item.id} disabled={!reach[item.id] && layer !== item.id} onChange={() => onLayer(layer === item.id ? null : item.id)} />
              <span>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {on && (
        <div className="sl-layer-on" role="status">
          <p>{state === 'failed' ? 'Moon Trek did not answer. Switch the layer off and on to try again.' : state === 'loading' ? 'Fetching from Moon Trek…' : on.says}</p>
          <p className="sl-layer-credit">
            <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">
              Moon Trek
            </a>
            : {on.title}
            {on.closeUp ? `; closest in, ${on.closeUp.title}` : ''}. Reaches {Math.round(trekHalfWidthM(on) / 1000)} km from the pole.
          </p>
          {on.id === 'photo' && fine && (
            <p className="sl-layer-credit">
              Within {Math.round(fine.radiusM / 1000)} km of each ridge site the same mosaic goes on to 1 m a pixel, from{' '}
              <a href="https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG" target="_blank" rel="noreferrer">
                LROC’s own files
              </a>
              : {fine.title}. {fine.credit}.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
