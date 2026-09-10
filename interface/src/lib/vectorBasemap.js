// The vector engine — MapLibre GL, drawn inside Leaflet by
// @maplibre/maplibre-gl-leaflet — loaded on demand.
//
// Leaflet initialises the console instantly: the view, the controls, the zone
// rings and the device canvas are all up before MapLibre has even been
// requested. MapLibre is ~1 MB of JavaScript, so it lives in its own chunk
// (Vite splits it off at the dynamic import below) and is fetched only when a
// vector ground is first needed; the ground then fades in underneath
// everything already on screen.
//
// MapLibre 6 ships pre-bundled and minified, so a bundler cannot shake its
// unused features out — the globe, terrain and 3D code arrive with it whether
// used or not. What the console controls is that none of it ever RUNS:
// lib/mapStyle.js strips projection, terrain, sky and extrusions from every
// style, and the GL map below is non-interactive with pitch locked at 0 —
// Leaflet owns the camera, and Leaflet is strictly 2D.

import { PREVIEW_VIEW } from '../constants/basemaps'

// ── WebGL ─────────────────────────────────────────────────────────────────────

let webglResult = null

/** MapLibre 6 needs WebGL 2. Probed once; the probe context is released. */
export function webglAvailable() {
  if (webglResult !== null) return webglResult
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    webglResult = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webglResult = false
  }
  return webglResult
}

// ── the engine ────────────────────────────────────────────────────────────────

let enginePromise = null

/**
 * { maplibreGL, maplibregl } once the chunk has loaded. Rejects when WebGL is
 * missing (permanently) or the chunk fails to load (the next call retries —
 * a dropped connection should not cost the vector map for the whole shift).
 */
export function loadVectorEngine() {
  if (!webglAvailable()) return Promise.reject(new Error('WebGL 2 is not available in this browser'))
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl'),
      // MapLibre finds its worker at runtime as `./maplibre-gl-worker.mjs`
      // next to its own module. A bundler cannot see that (the name is built
      // at runtime), so the file is never emitted and every tile request
      // would die with the worker. Bundle the worker explicitly and hand
      // MapLibre its real URL instead.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([plugin, maplibregl, worker]) => {
      maplibregl.setWorkerUrl(worker.default)
      return { maplibreGL: plugin.maplibreGL, maplibregl }
    })
    enginePromise.catch(() => { enginePromise = null })
  }
  return enginePromise
}

// ── styles ────────────────────────────────────────────────────────────────────

const styleCache = new Map()   // url → Promise<style JSON>

/** A style's JSON, fetched once per URL. A failed fetch is not cached. */
export function fetchStyle(url) {
  if (!styleCache.has(url)) {
    const request = fetch(url, { credentials: 'omit' }).then((res) => {
      if (!res.ok) throw new Error(`style ${url} answered HTTP ${res.status}`)
      return res.json()
    })
    request.catch(() => styleCache.delete(url))
    styleCache.set(url, request)
  }
  return styleCache.get(url)
}

// ── the Leaflet layer ─────────────────────────────────────────────────────────

// GL map options shared by the live layer and the previews: flat, still, and
// quick. Leaflet handles every gesture, so the GL map takes no input at all.
const FLAT = {
  interactive: false,
  maxPitch: 0,
  pitchWithRotate: false,
  dragRotate: false,
  touchPitch: false,
  validateStyle: false,   // prepared from a known style; skip the second pass
}

/**
 * A Leaflet layer drawing `style` (already run through prepareStyle) with
 * MapLibre, credited with `attribution`. It goes in Leaflet's tile pane, under
 * the zone rings and the device canvas.
 */
export function createVectorLayer(engine, style, attribution) {
  return engine.maplibreGL({
    ...FLAT,
    style,
    fadeDuration: 150,
    // The plugin reads the credit from here; OpenFreeMap's sources carry none.
    attributionControl: { customAttribution: attribution },
  })
}

/**
 * Resolves once a GL map has drawn its first complete frame — style, sprites
 * and the visible tiles — or after `timeout` ms, whichever comes first, so a
 * slow tile can never hold the old ground on screen forever.
 */
export function firstRender(glMap, timeout = 6000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout)
    glMap.once('idle', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

// ── previews ──────────────────────────────────────────────────────────────────
//
// The Settings picker shows each basemap as it really is, over the Al Haouz
// epicentre. For a vector basemap that is a real render: an off-screen GL map,
// drawn once, read back as an image, and destroyed — one at a time, so the
// picker never holds more than one extra WebGL context.

const snapshots = new Map()   // `${url}|${profile}` → Promise<dataURL>
let queue = Promise.resolve()

/**
 * An image (data URL) of `style` at the preview view, cached per key.
 * Rejects when the engine is unavailable or the render times out.
 */
export function snapshotStyle(key, style, { width = 448, height = 196 } = {}) {
  if (snapshots.has(key)) return snapshots.get(key)
  const job = queue.then(() => renderSnapshot(style, width, height))
  queue = job.catch(() => {})
  job.catch(() => snapshots.delete(key))
  snapshots.set(key, job)
  return job
}

async function renderSnapshot(style, width, height) {
  const { maplibregl } = await loadVectorEngine()
  const host = document.createElement('div')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
  })
  document.body.appendChild(host)

  let glMap = null
  try {
    glMap = new maplibregl.Map({
      ...FLAT,
      container: host,
      style,
      center: PREVIEW_VIEW.center,
      zoom: PREVIEW_VIEW.zoom,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio: 2,
      // Without this the canvas is cleared after compositing, and reading it
      // back returns a blank image.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview render timed out')), 12000)
      glMap.once('idle', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    return glMap.getCanvas().toDataURL('image/webp', 0.9)
  } finally {
    glMap?.remove()
    host.remove()
  }
}
