/** What decides whether the 3D view opens by itself. It costs a few megabytes and graphics memory. */
export interface DeviceHints {
  widthPx: number
  coarsePointer: boolean
  saveData: boolean
  webgl2: boolean
}

const WIDE_SCREEN_PX = 900

/**
 * Open 3D first only on a large screen with a mouse. On a phone it's one tap away instead, so nobody
 * downloads terrain on a data plan before asking, and the page can't be hurt by a phone taking its
 * graphics away.
 */
export function opens3dFirst(device: DeviceHints): boolean {
  return device.webgl2 && !device.saveData && !device.coarsePointer && device.widthPx >= WIDE_SCREEN_PX
}

/** This browser's hints. */
export function readDeviceHints(): DeviceHints {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return {
    widthPx: window.innerWidth,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    saveData: connection?.saveData === true,
    webgl2: typeof WebGL2RenderingContext !== 'undefined',
  }
}
