import { pointHorizons, type PolarGround } from '../lib/pointHorizons'

/**
 * Skylines worked out off the page's thread (`pointHorizons.ts`). A job is some map-plane points
 * over one piece of ground; each point's skylines are sent back as soon as they are done, so the
 * page can say how far along the work is.
 */

export interface HorizonJob {
  job: number
  ground: PolarGround
  /** Map-plane x and y (m) of each point, one after the other. */
  points: Float64Array
  /** The observer heights wanted (m). */
  heightsM: number[]
}

/** One point's answer: which point of the job it is, its ground height and a mask for each height. `done` on a job's last. */
export interface HorizonAnswer {
  job: number
  index: number
  heightM: number
  masks: Float32Array[]
  done: boolean
}

const scope = self as unknown as { postMessage(answer: HorizonAnswer, transfer: Transferable[]): void; addEventListener(type: 'message', listener: (event: MessageEvent<HorizonJob>) => void): void }

scope.addEventListener('message', (event) => {
  const { job, ground, points, heightsM } = event.data
  const count = points.length / 2
  for (let index = 0; index < count; index += 1) {
    const { heightM, masks } = pointHorizons(ground, points[2 * index], points[2 * index + 1], heightsM)
    scope.postMessage(
      { job, index, heightM, masks, done: index === count - 1 },
      masks.map((mask) => mask.buffer),
    )
  }
})
