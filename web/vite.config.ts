/// <reference types="vitest/config" />
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { dataVersion } from './scripts/data-version.mjs'

// Names this build, so an open tab can tell when a newer one is live (see src/data/staleBuild.ts).
const BUILD_ID = new Date().toISOString()

/** Writes version.json next to index.html with this build's id. */
function buildId(): Plugin {
  return {
    name: 'build-id',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

/**
 * Keeps the terrain tiles out of the build: they live in a Cloud Storage bucket and the server
 * streams them, so the image is a few MB instead of 1.5 GB. Vite copies public/ into dist/, so this
 * removes dist/tiles after.
 */
/**
 * What every page runs before its own script, so a page whose script does not arrive tries again
 * instead of staying blank.
 *
 * During a deploy a tenth of visitors get the new version for about a minute. Each version holds
 * only its own script files (their names carry a hash of their contents), and a request is sent to
 * either version whatever page asked for it. So a page from one version can ask the other for its
 * script and be told 404, which is not kept anywhere: the page stays empty. Reloading asks again,
 * and nine times in ten lands on the version most visitors are on, whose files the CDN holds.
 *
 * The page reloads when one of its own files under /assets/ fails to load: at most three times,
 * a little later each time, counted for the tab so nothing can loop. If it still has nothing, it
 * says so in plain words. The count is cleared once a page has drawn.
 */
const HEALS_ITSELF = `(function(){var K='reloads-for-missing-script',asked=false;function again(){if(asked)return;asked=true;var n=0;try{n=Number(sessionStorage.getItem(K)||0);if(n>=3){var p=document.createElement('p');p.id='page-is-updating';p.style.cssText='margin:3rem auto;max-width:28rem;padding:0 1rem;font:1rem/1.5 system-ui,sans-serif;color:#e8e6df';p.textContent='The site is being updated right now. Reload this page in a moment.';(document.body||document.documentElement).appendChild(p);return}sessionStorage.setItem(K,String(n+1))}catch(e){return}setTimeout(function(){location.reload()},500+1000*n)}addEventListener('error',function(e){var t=e.target;if(!t||t===window)return;var u=String(t.src||t.href||'');if((t.tagName==='SCRIPT'||t.tagName==='LINK')&&u.indexOf('/assets/')>=0)again()},true);addEventListener('load',function(){setTimeout(function(){try{var r=document.getElementById('root');if(!asked&&r&&r.childNodes.length)sessionStorage.removeItem(K)}catch(e){}},4000)})})()`

function healsItself(): Plugin {
  return {
    name: 'page-heals-itself',
    transformIndexHtml() {
      return [{ tag: 'script', children: HEALS_ITSELF, injectTo: 'head-prepend' }]
    },
  }
}

/**
 * three.js's transcoder for the 8K color map (a KTX2 file): two files its loader fetches by name
 * from one folder, /basis/. They are served from three's own package in dev and copied into the
 * build, so they always match the three.js in use and no binary is kept in Git.
 */
function basisTranscoder(): Plugin {
  const from = new URL('./node_modules/three/examples/jsm/libs/basis/', import.meta.url)
  const files: Record<string, string> = { 'basis_transcoder.js': 'text/javascript', 'basis_transcoder.wasm': 'application/wasm' }
  let building = false
  return {
    name: 'basis-transcoder',
    config(_, { command }) {
      building = command === 'build'
    },
    configureServer(server) {
      server.middlewares.use('/basis', (request, response, next) => {
        const name = (request.url ?? '').split('?')[0].slice(1)
        if (!(name in files)) return next()
        response.setHeader('content-type', files[name])
        response.end(readFileSync(new URL(name, from)))
      })
    },
    closeBundle() {
      if (!building) return
      const to = new URL('./dist/basis/', import.meta.url)
      mkdirSync(to, { recursive: true })
      for (const name of Object.keys(files)) copyFileSync(new URL(name, from), new URL(name, to))
    },
  }
}

function tilesStayInBucket(): Plugin {
  return {
    name: 'tiles-stay-in-bucket',
    apply: 'build',
    closeBundle() {
      rmSync(new URL('./dist/tiles', import.meta.url), { recursive: true, force: true })
    },
  }
}

/**
 * Writes data-version.json next to index.html: a hash of every file under data/. Each service
 * reports the hash of the data it was built with, so a deploy can tell they all hold the same data
 * (the server reads this file at start; the events worker's image computes the same hash).
 */
function dataVersionFile(): Plugin {
  return {
    name: 'data-version',
    apply: 'build',
    closeBundle() {
      const dist = new URL('./dist/', import.meta.url)
      writeFileSync(new URL('data-version.json', dist), JSON.stringify({ dataVersion: dataVersion(fileURLToPath(new URL('data', dist))) }))
    },
  }
}

const LIVE_SITE = 'https://shackletonstation.dev'
/**
 * Where the dev server sends /api, /tiles and /media. By default the live site, so a fresh clone
 * needs no cloud access. When working on the server itself, run `npm run dev:server` in another
 * terminal and start this with `BACKEND=http://localhost:8080 npm run dev`.
 */
const BACKEND = process.env.BACKEND ?? LIVE_SITE
/** With local tiles (after a pipeline run), the dev server serves those instead of the backend's. */
const localTiles = existsSync(new URL('./public/tiles/manifest.json', import.meta.url))
const toBackend = { target: BACKEND, changeOrigin: true }

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), buildId(), healsItself(), tilesStayInBucket(), basisTranscoder(), dataVersionFile()],
  build: {
    rollupOptions: {
      // Six pages: the site, Scout (the guided version at /scout/), the Planner (the grid-first
      // version with no globe, at /planner/), the Atlas (computed light on the polar ground, at /atlas/),
      // the Briefing (the two-minute narrated story, at /briefing/) and the Surface (the view from the
      // lander's eye, at /surface/). And one easter egg, at /hype/,
      // two plain pages Google's sign-in screen links to, at /privacy/ and /terms/,
      // and one measurement that is on no tab: the globe on WebGL2 next to the same globe on WebGPU, at /gpu/.
      // Sightline, the one-screen redesign, is the front page (and still answers at /sightline/, where it was built).
      // The site as it was before, with its tabs, is at /classic/.
      input: { classic: 'classic/index.html', privacy: 'privacy/index.html', terms: 'terms/index.html' },
    },
  },
  server: {
    proxy: {
      // The API only answers its own pages, so the forwarded request says it comes from the backend.
      '/api': { ...toBackend, headers: { origin: BACKEND } },
      ...(localTiles ? {} : { '/tiles': toBackend }),
      // Moon Trek's map tiles come through the live site's CDN (infra/trek.tf), as they do for visitors.
      '/trek': toBackend,
      // The demo video lives only in the bucket, so the dev server always plays the backend's copy.
      '/media': toBackend,
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts', 'events-worker/**/*.test.ts', 'plans/**/*.test.ts', 'copilot/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
})
