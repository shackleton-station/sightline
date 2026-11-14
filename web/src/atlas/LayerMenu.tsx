import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { LightView } from '../three/lightLayer'
import { CheckIcon, ChevronIcon, LayersIcon } from './icons'

export interface LayerOption {
  id: LightView
  label: string
  hint: string
}

interface Props {
  layers: LayerOption[]
  layer: LightView
  onLayer: (layer: LightView) => void
  /** What the colors mean and how the ground was computed, shown under the choices. */
  children: ReactNode
}

/**
 * One dropdown for how the polar ground is colored: the choices, each with a line on what it shows,
 * and the key for the one chosen. It starts open on a wide screen so the key is seen; Escape or a click
 * outside closes it, and focus goes back to the button.
 */
export function LayerMenu({ layers, layer, onLayer, children }: Props) {
  // Open at first on a wide screen; on a phone it would cover the map, so it starts closed.
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 821px)').matches === true)
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const chosen = layers.find((option) => option.id === layer) ?? layers[0]

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  return (
    <div
      className={open ? 'atlas-menu open' : 'atlas-menu'}
      ref={root}
      data-tour="layers"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false)
          button.current?.focus()
        }
      }}
    >
      <button type="button" ref={button} className="atlas-menu-button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <LayersIcon className="atlas-menu-icon" />
        <span className="atlas-menu-words">
          <span className="atlas-eyebrow">Color the ground by</span>
          <span className="atlas-menu-chosen">{chosen.label}</span>
        </span>
        <ChevronIcon size={18} className="atlas-menu-chevron" />
      </button>
      {open && (
        <div className="atlas-menu-panel" id={panelId}>
          <div role="radiogroup" aria-label="Color the polar ground by">
            {layers.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === layer}
                className="atlas-menu-option"
                onClick={() => onLayer(option.id)}
              >
                <span className={`atlas-swatch swatch-${option.id}`} aria-hidden="true" />
                <span className="atlas-menu-option-words">
                  <span className="atlas-menu-option-label">{option.label}</span>
                  <span className="atlas-menu-option-hint">{option.hint}</span>
                </span>
                {option.id === layer && <CheckIcon size={18} className="atlas-menu-check" />}
              </button>
            ))}
          </div>
          <div className="atlas-menu-key">{children}</div>
        </div>
      )}
    </div>
  )
}
