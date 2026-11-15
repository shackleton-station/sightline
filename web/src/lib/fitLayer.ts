/**
 * Whether "Landings that fit" is offered: the layer that shades the Moon by where a landing fits
 * the mission, with its switch in Layers, its switch in Landing accuracy and its key on the stage.
 *
 * It is not offered for now (2026-11-15). Its picture on the Moon and Landing accuracy's map answer
 * the same question and are drawn differently, at very different scales, so the two read as if they
 * disagreed; making them one picture is longer work than the day had (docs/PROGRESS.md, "Landings
 * that fit" against the ground point by point). Nothing was taken out: the layer is as it was for
 * anyone who opens the page with `?fitlayer=1` in the address, which is how it is worked on. The
 * page takes the query off its address once it has loaded, so it has to be typed again to reload.
 */
export function fitLayerOffered(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('fitlayer') === '1'
}
