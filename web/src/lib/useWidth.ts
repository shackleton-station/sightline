import { useCallback, useState } from 'react'

/** Measured pixel width of an element; 0 until first measured. Attach the ref to the element. */
export function useWidth(): [(element: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0)
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
