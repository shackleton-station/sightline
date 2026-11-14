import { useEffect, useRef, useState } from 'react'

/** How long the pointer rests on something before its explanation shows. A focused element shows it at once. */
const SHOW_AFTER_MS = 150
const GAP_PX = 8
const EDGE_PX = 8

interface Shown {
  text: string
  /** The element the explanation is about, as it lies on the screen. */
  box: DOMRect
}

/**
 * One tooltip for the whole screen. Anything with an explanation (a `title`) shows it here, promptly,
 * on hover and on keyboard focus, in one style, instead of the browser's slow bubble. The words stay
 * on the element as its description for a screen reader. The tooltip is placed beside its element
 * where it does not lie over the Moon's disc, if there is room for that.
 */
export function Tips() {
  const [shown, setShown] = useState<Shown | null>(null)
  const tip = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let timer = 0
    let about: Element | null = null
    /** The nearest element with an explanation. A `title` is taken over: its words become ours to show, and the browser's own bubble never appears. */
    const explained = (target: EventTarget | null): HTMLElement | null => {
      const el = target instanceof Element ? target.closest<HTMLElement>('[title], [data-tip]') : null
      if (!el) return null
      const title = el.getAttribute('title')
      if (title) {
        el.dataset.tip = title
        if (!el.hasAttribute('aria-label') || el.getAttribute('aria-label') !== title) el.setAttribute('aria-description', title)
        el.removeAttribute('title')
      }
      return el.dataset.tip ? el : null
    }
    const show = (el: HTMLElement, wait: number) => {
      window.clearTimeout(timer)
      about = el
      timer = window.setTimeout(() => setShown({ text: el.dataset.tip ?? '', box: el.getBoundingClientRect() }), wait)
    }
    const hide = () => {
      window.clearTimeout(timer)
      about = null
      setShown(null)
    }
    const onOver = (event: Event) => {
      const el = explained(event.target)
      if (el && el !== about) show(el, SHOW_AFTER_MS)
      else if (!el) hide()
    }
    // A focus that follows a press of the pointer is that press; any other came from the keyboard.
    let pressedAt = 0
    const onPress = () => {
      pressedAt = performance.now()
      hide()
    }
    const onFocus = (event: Event) => {
      const el = explained(event.target)
      if (el && performance.now() - pressedAt > 400) show(el, 0)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', onPress)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', onPress)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  // Once drawn, its own size is known: put it under its element, or over it, or beside it; the first
  // of those that fits the window and stays off the Moon's disc, else the first that fits the window.
  useEffect(() => {
    const el = tip.current
    if (!shown || !el) {
      setPlace(null)
      return
    }
    const { width, height } = el.getBoundingClientRect()
    const { box } = shown
    const middle = box.left + box.width / 2 - width / 2
    const level = box.top + box.height / 2 - height / 2
    const spots = [
      { left: middle, top: box.bottom + GAP_PX },
      { left: middle, top: box.top - GAP_PX - height },
      { left: box.right + GAP_PX, top: level },
      { left: box.left - GAP_PX - width, top: level },
    ].map((spot) => ({ left: Math.min(Math.max(spot.left, EDGE_PX), window.innerWidth - width - EDGE_PX), top: spot.top }))
    const fits = (spot: { left: number; top: number }) => spot.top >= EDGE_PX && spot.top + height <= window.innerHeight - EDGE_PX
    const globe = document.querySelector<HTMLElement>('.scout-globe')
    const disc = globe ? { box: globe.getBoundingClientRect(), r: Number(globe.dataset.discPx) / 2 } : null
    const offMoon = (spot: { left: number; top: number }) => {
      if (!disc || !(disc.r > 0)) return true
      const cx = (disc.box.left + disc.box.right) / 2
      const cy = (disc.box.top + disc.box.bottom) / 2
      const x = Math.min(Math.max(cx, spot.left), spot.left + width)
      const y = Math.min(Math.max(cy, spot.top), spot.top + height)
      return Math.hypot(x - cx, y - cy) >= disc.r
    }
    setPlace(spots.find((spot) => fits(spot) && offMoon(spot)) ?? spots.find(fits) ?? spots[0])
  }, [shown])

  if (!shown) return null
  return (
    <div ref={tip} className="sl-tip" role="tooltip" style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {shown.text}
    </div>
  )
}
