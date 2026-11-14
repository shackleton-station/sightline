/** How far apart two pictures of the same size are, over the pixels either one drew on. */
export interface PictureDifference {
  /** Pixels compared (the Moon's disk; the empty corners are left out). */
  pixels: number
  /** The average gap per color channel, in screen steps (0 to 255). */
  meanSteps: number
  /** The share of pixels where some channel is more than 8 steps apart, in percent. */
  over8Pct: number
}

function pixelsOf(canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width === 0) return null
  context.drawImage(canvas, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

/**
 * Compare what two canvases show right now. Call it in the same task that drew them: a WebGL or
 * WebGPU canvas hands its picture to the screen when the task ends and can't be read after that.
 */
export function pictureDifference(first: HTMLCanvasElement, second: HTMLCanvasElement): PictureDifference | null {
  if (first.width !== second.width || first.height !== second.height) return null
  const a = pixelsOf(first)
  const b = pixelsOf(second)
  if (!a || !b) return null
  let pixels = 0
  let total = 0
  let over8 = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue
    const gaps = [Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])]
    pixels += 1
    total += gaps[0] + gaps[1] + gaps[2]
    if (Math.max(...gaps) > 8) over8 += 1
  }
  if (pixels === 0) return null
  return { pixels, meanSteps: total / (3 * pixels), over8Pct: (100 * over8) / pixels }
}
