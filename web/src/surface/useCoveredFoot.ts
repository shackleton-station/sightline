import { type RefObject, useEffect, useState } from 'react'

/** What lies over the foot of the picture: the answer's band, and the note and buttons in the corner. */
const COVERS = '.sf-answer, .sf-actions'
/** A name pinned at the foot is about this wide, centred in the picture (px). */
const NAME_HALF_PX = 110
/** The gap kept between a pinned name and what covers the foot, and from the picture's own edge (px). */
const GAP_PX = 8

/**
 * How much of the foot of a view is covered where a name would be pinned (px), measured from what is
 * on the page: the answer's band is as tall as its words, and inside Sightline's frame the picture is
 * short, so no fixed figure fits both. Measured again whenever the picture or a cover changes size.
 */
export function useCoveredFoot(stage: RefObject<HTMLElement | null>): number {
  const [covered, setCovered] = useState(GAP_PX)

  useEffect(() => {
    const picture = stage.current
    if (!picture) return
    const covers = [...document.querySelectorAll<HTMLElement>(COVERS)]
    const measure = () => {
      const box = picture.getBoundingClientRect()
      const middle = (box.left + box.right) / 2
      const tops = covers
        .map((cover) => cover.getBoundingClientRect())
        // Only what reaches into this picture, across the middle where the name goes.
        .filter((cover) => cover.width > 0 && cover.left < middle + NAME_HALF_PX && cover.right > middle - NAME_HALF_PX && cover.top < box.bottom && cover.bottom > box.top)
        .map((cover) => cover.top)
      setCovered(Math.max(box.bottom - Math.min(box.bottom, ...tops), 0) + GAP_PX)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(picture)
    covers.forEach((cover) => observer.observe(cover))
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [stage])

  return covered
}
