/** Where a place is from the site, as a clock face on the map (12 is up the map, toward 0° longitude). */
export function clock(x: number, y: number): string {
  const angle = (Math.atan2(x, y) * 180) / Math.PI
  const hour = ((Math.round(angle / 30) % 12) + 12) % 12
  return `${hour === 0 ? 12 : hour} o'clock`
}
