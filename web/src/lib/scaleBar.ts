const SCALE_STEPS_KM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]

/** A round length of ground whose bar is between about 60 and 150 pixels long, for a map's scale bar. */
export function scaleBar(kmPerPx: number): { km: number; px: number } {
  const km = SCALE_STEPS_KM.find((step) => step / kmPerPx >= 60) ?? SCALE_STEPS_KM[SCALE_STEPS_KM.length - 1]
  return { km, px: km / kmPerPx }
}

/** "5 km" or "200 m". */
export function scaleWords(km: number): string {
  return km >= 1 ? `${km} km` : `${km * 1000} m`
}
