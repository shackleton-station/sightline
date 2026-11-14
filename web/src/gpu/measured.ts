import type { SideName } from './compare'

/**
 * The JavaScript each side downloads before it can draw, from `npm run build` on 2026-11-12 with
 * three 0.187.0 (kB, gzipped). A page can't tell which of its files belong to which side, so these
 * are written down here: build again and update them if Three.js or either viewer changes.
 */
export const BUNDLES: Record<SideName, { files: { name: string; gzipKb: number }[]; note: string }> = {
  webgl2: {
    files: [
      { name: 'GlobeViewer', gzipKb: 7.3 },
      { name: 'three.module', gzipKb: 84.3 },
      { name: 'three.core', gzipKb: 56.3 },
    ],
    note: 'three.module is the WebGL renderer.',
  },
  webgpu: {
    files: [
      { name: 'GlobeViewerGpu', gzipKb: 171.5 },
      { name: 'three.core', gzipKb: 56.3 },
    ],
    note: 'GlobeViewerGpu carries the WebGPU renderer, its WebGL2 fallback and the node system.',
  },
}

/** Both sides use the same three.core file, so this page downloads it once. */
export const SHARED_NOTE = 'three.core is the same file on both sides.'
