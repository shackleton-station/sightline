import { useEffect, useRef, useState } from 'react'
import { type SystemArrow, type SystemFacts, SYSTEM_ARROWS, systemAreas } from './systemDesign'

interface Point {
  x: number
  y: number
}

/** Where an arrow meets a box: the middle of a side, or `at` of the way along it. */
function meet(box: DOMRect, origin: DOMRect, side: SystemArrow['sides'][number], at = 0.5): Point {
  const left = box.left - origin.left
  const top = box.top - origin.top
  if (side === 'top') return { x: left + box.width * at, y: top }
  if (side === 'bottom') return { x: left + box.width * at, y: top + box.height }
  if (side === 'left') return { x: left, y: top + box.height * at }
  return { x: left + box.width, y: top + box.height * at }
}

/** An arrow's line between two boxes: straight down or up, a curve across, or round the outside when both ends are left sides. */
function route(from: Point, to: Point, [out, into]: SystemArrow['sides']): string {
  const r = (n: number) => Math.round(n * 10) / 10
  if (out === 'left' && into === 'left') {
    const x = Math.min(from.x, to.x) - 10
    return `M${r(from.x)} ${r(from.y)} H${r(x)} V${r(to.y)} H${r(to.x)}`
  }
  if (out === 'right' || out === 'left') {
    const mid = (from.x + to.x) / 2
    return `M${r(from.x)} ${r(from.y)} C${r(mid)} ${r(from.y)} ${r(mid)} ${r(to.y)} ${r(to.x)} ${r(to.y)}`
  }
  return `M${r(from.x)} ${r(from.y)} L${r(to.x)} ${r(to.y)}`
}

/**
 * How the system is built: every part as a box of real text, by area, with the arrows drawn over
 * them from where the boxes actually are. On a narrow window the picture keeps its width and
 * scrolls sideways. The arrows are also given in words under it.
 */
export function GuideSystem(facts: SystemFacts) {
  const areas = systemAreas(facts)
  const canvas = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<{ d: string; line?: SystemArrow['line'] }[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })
  // The boxes take the height their words need, so the arrows are measured, not typed in: once the
  // picture is laid out, and again whenever its size changes.
  useEffect(() => {
    const board = canvas.current
    if (!board) return
    const draw = () => {
      const origin = board.getBoundingClientRect()
      const box = (id: string) => board.querySelector(`[data-box="${id}"]`)?.getBoundingClientRect()
      setSize({ width: board.scrollWidth, height: board.scrollHeight })
      setLines(
        SYSTEM_ARROWS.flatMap((arrow) => {
          const from = box(arrow.from)
          const to = box(arrow.to)
          if (!from || !to) return []
          const start = meet(from, origin, arrow.sides[0], arrow.at)
          const end = meet(to, origin, arrow.sides[1])
          // An arrow down or up stays upright: it lands where it left, if the box it reaches is under that point.
          if (arrow.sides[0] === 'bottom' || arrow.sides[0] === 'top') end.x = Math.min(Math.max(start.x, to.left - origin.left + 12), to.right - origin.left - 12)
          return [{ d: route(start, end, arrow.sides), line: arrow.line }]
        }),
      )
    }
    draw()
    if (typeof ResizeObserver === 'undefined') return
    const watcher = new ResizeObserver(draw)
    watcher.observe(board)
    return () => watcher.disconnect()
  }, [facts.siteCount, facts.span, facts.model])

  return (
    <section className="how-step how-system" id="how-system" aria-labelledby="how-system-title">
      <div className="how-system-head">
        <p className="how-kicker">Under the hood</p>
        <h2 id="how-system-title">How the system is built</h2>
        <p className="how-lede">One door in: the load balancer sends every path to its own service. Four small services, each with its own identity, and no stored key anywhere.</p>
      </div>
      <div className="how-system-scroll" tabIndex={0} role="group" aria-label="The system design. It scrolls sideways on a narrow window.">
        <div className="how-system-canvas" ref={canvas}>
          {areas.map((area) => (
            <section key={area.id} className="how-area" data-area={area.id} aria-label={area.title}>
              <h3>{area.title}</h3>
              <div className="how-area-boxes">
                {area.boxes.map((box) => (
                  <div key={box.id} className="how-box" data-box={box.id} data-kind={box.kind}>
                    <b>{box.name}</b>
                    <span>{box.says}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <section className="how-area" data-area="key" aria-label="Key">
            <h3>Key</h3>
            <div className="how-area-boxes">
              <div className="how-box" data-kind="ours">
                <b>Our code</b>
              </div>
              <div className="how-box" data-kind="store">
                <b>Data store</b>
              </div>
              <div className="how-box" data-kind="outside">
                <b>Managed or outside service</b>
              </div>
            </div>
            <p>A dashed arrow is the failure path. A dotted arrow is a status check.</p>
          </section>
          <svg className="how-system-lines" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
            <defs>
              <marker id="how-system-tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" />
              </marker>
            </defs>
            {lines.map((line) => (
              <path key={line.d} d={line.d} data-line={line.line} markerEnd="url(#how-system-tip)" />
            ))}
          </svg>
        </div>
      </div>
      <p className="how-note how-system-hint">The picture is wider than this window: it scrolls sideways.</p>
      <details className="how-more how-system-words">
        <summary>The arrows, in words</summary>
        <ul>
          {SYSTEM_ARROWS.map((arrow) => (
            <li key={`${arrow.from}-${arrow.to}`}>{arrow.says}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}
