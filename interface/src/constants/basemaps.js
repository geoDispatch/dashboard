// The four basemaps the operator can switch between.
//
// ── Two renderers ─────────────────────────────────────────────────────────
// Three of the four are VECTOR maps: OpenFreeMap styles drawn by MapLibre GL
// inside Leaflet (@maplibre/maplibre-gl-leaflet, see lib/vectorBasemap.js).
// Leaflet still owns everything else — the view, the controls, the device dots
// on their canvas, the zone rings, hit-testing — so the console initialises as
// fast as it always did, and the vector ground fades in once MapLibre has
// loaded (it is a separate, lazily fetched chunk). Vector tiles zoom and pan
// without the blur-then-sharpen of raster tiles, and they can be recoloured to
// the theme (lib/mapStyle.js).
//
// Satellite stays RASTER: imagery has no vector equivalent.
//
// Every vector basemap also carries a `raster` fallback — the Esri look it
// replaced. If WebGL is unavailable, or the style or the engine fails to load,
// the console draws that instead of an empty ground.
//
// ── Why OpenFreeMap, and why none of these is CARTO ────────────────────────
// OpenFreeMap needs no key and no account, and its styles, tiles, fonts and
// sprites all come from one host. CARTO's Dark Matter, Positron and Voyager
// no longer work without an account: every raster tile still returns HTTP 200
// and a valid PNG, but the image is a flat panel reading "API KEY REQUIRED" —
// Leaflet has nothing to fall back to, and the map is made of watermarks.
// Esri's raster basemaps are keyless, which is why they are the fallback.
//
// ── Shape ─────────────────────────────────────────────────────────────────
// `vector.style` is a MapLibre style URL. `vector.tint` means the style follows
// the theme: it is recoloured graphite, or navy in Dark blue.
// `raster.layers` are drawn bottom-up; a label layer goes in Leaflet's
// shadowPane, above the ground but below the canvas the dots are drawn on.
// `raster.maxZoom` genuinely differs: the grey canvases stop at 16 and return
// an empty tile past it, while imagery and streets go to 19 — and z19 imagery
// is what makes a collapsed roof visible, the reason satellite exists at all.

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_CREDIT = 'Tiles © Esri'

const OFM = 'https://tiles.openfreemap.org/styles'
// OpenFreeMap's required credit. Its style sources carry no attribution field,
// so the Leaflet layer is given this string explicitly.
export const OFM_CREDIT =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'

// Vector tiles hold data to z14 and are drawn sharp past it, so every vector
// basemap zooms as deep as imagery does.
const VECTOR_MAX_ZOOM = 19

// One real raster tile over the Al Haouz epicentre, used as the picker's
// preview for raster basemaps (and for vector ones when WebGL is unavailable).
// It is the basemap itself at z11, not an illustration of it.
const PREVIEW_TILE = { z: 11, x: 976, y: 837 }

export const BASEMAPS = [
  {
    key: 'dark',
    name: 'Tactical dark',
    blurb: 'High contrast for dim operations rooms.',
    ground: '#383b41',
    vector: { style: `${OFM}/dark`, tint: true },
    raster: {
      maxZoom: 16,
      base: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      attribution: `${ESRI_CREDIT}, dark gray canvas`,
    },
  },
  {
    key: 'light',
    name: 'Daylight clean',
    blurb: 'Muted grey for bright environments.',
    ground: '#f2f3f0',
    vector: { style: `${OFM}/positron`, tint: false },
    raster: {
      maxZoom: 16,
      base: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      attribution: `${ESRI_CREDIT}, light gray canvas`,
    },
  },
  {
    key: 'satellite',
    name: 'Satellite imagery',
    blurb: 'Terrain and building imagery for damage review.',
    ground: '#5b5138',
    vector: null,
    raster: {
      maxZoom: 19,
      base: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
      labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
      attribution: `${ESRI_CREDIT}, Maxar, Earthstar Geographics`,
    },
  },
  {
    key: 'streets',
    name: 'Streets and roads',
    blurb: 'Roads, place names and transport routes.',
    ground: '#f8f4f0',
    vector: { style: `${OFM}/liberty`, tint: false },
    raster: {
      maxZoom: 19,
      // Street tiles carry their own labels; a second layer would double them.
      base: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
      labels: null,
      attribution: `${ESRI_CREDIT}, HERE, Garmin, OpenStreetMap contributors`,
    },
  },
]

export const BASEMAP_KEYS = BASEMAPS.map((b) => b.key)

export const DEFAULT_BASEMAP = 'light'

/** The definition for a key, falling back to the default rather than to null. */
export function basemapFor(key) {
  return BASEMAPS.find((b) => b.key === key) || BASEMAPS.find((b) => b.key === DEFAULT_BASEMAP)
}

/** How deep the operator may zoom with this basemap on this renderer. */
export function maxZoomFor(basemap, renderer) {
  return renderer === 'vector' && basemap.vector ? VECTOR_MAX_ZOOM : basemap.raster.maxZoom
}

/**
 * The recolour profile (lib/mapStyle.js PROFILES) a basemap is drawn with in
 * a theme, or null for the style's own colours. Only the dark canvas follows
 * the theme: graphite everywhere, navy in Dark blue. Streets and the light
 * canvas are information, not mood, and keep their colours.
 */
export function profileFor(basemap, theme) {
  if (!basemap.vector || !basemap.vector.tint) return null
  return theme === 'dark-blue' ? 'navy' : 'graphite'
}

/** The Al Haouz epicentre view the picker's previews are drawn at. */
export const PREVIEW_VIEW = { center: [-8.4144, 31.0625], zoom: 10 }

/** A single real RASTER tile of this basemap, for the picker's preview image. */
export function basemapPreview(basemap) {
  return basemap.raster.base
    .replace('{z}', PREVIEW_TILE.z)
    .replace('{x}', PREVIEW_TILE.x)
    .replace('{y}', PREVIEW_TILE.y)
}
