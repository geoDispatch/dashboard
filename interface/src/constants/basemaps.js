// The four basemaps the operator can switch between.
//
// ── Why none of these is CARTO ─────────────────────────────────────────────
// The obvious picks for this list are CARTO's Dark Matter, Positron and
// Voyager. They no longer work without an account: every tile still returns
// HTTP 200 and a valid PNG, but the image is a flat panel reading
// "API KEY REQUIRED — carto.com/basemaps/apikey". Because the request
// succeeds, Leaflet has nothing to fall back to and the console would show a
// map made entirely of watermarks — verified against all three styles.
//
// Esri's ArcGIS Online basemaps are keyless and serve the same four looks, so
// the whole set comes from one provider with one attribution string.
//
// ── Shape ─────────────────────────────────────────────────────────────────
// `layers` is drawn bottom-up. A second entry is a label layer and goes in
// Leaflet's shadowPane, which sits above the tile pane but below the canvas
// the device dots are drawn on — so place names stay readable without ever
// covering a dot.
//
// `maxZoom` is per basemap and genuinely differs: the grey canvas styles stop
// at 16 and return an empty tile past it, while imagery and streets go to 19.
// That last stop matters — z19 imagery is what makes a collapsed roof visible,
// which is the whole reason the satellite option exists.

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_CREDIT = 'Tiles © Esri'

// One real tile over the Al Haouz epicentre, used as the picker's preview.
// It is the basemap itself at z11, not an illustration of it.
const PREVIEW_TILE = { z: 11, x: 976, y: 837 }

export const BASEMAPS = [
  {
    key: 'dark',
    name: 'Tactical dark',
    blurb: 'For a dimmed operations room. The highest contrast behind red, orange and green dots.',
    maxZoom: 16,
    ground: '#3f4448',
    base: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_CREDIT} — dark gray canvas`,
  },
  {
    key: 'light',
    name: 'Daylight clean',
    blurb: 'The console default. A muted grey ground that keeps every zone ring legible in daylight.',
    maxZoom: 16,
    ground: '#e6e8ea',
    base: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_CREDIT} — light gray canvas`,
  },
  {
    key: 'satellite',
    name: 'Satellite imagery',
    blurb: 'Real terrain, valleys and building footprints. Zooms to 19 for structural damage triage.',
    maxZoom: 19,
    ground: '#5b5138',
    base: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_CREDIT} — Maxar, Earthstar Geographics`,
  },
  {
    key: 'streets',
    name: 'Streets and roads',
    blurb: 'Road layouts, neighbourhood names and transport arteries — the view a rescue convoy drives.',
    maxZoom: 19,
    ground: '#efe9e1',
    // Street tiles carry their own labels; a second layer would double them.
    base: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    labels: null,
    attribution: `${ESRI_CREDIT} — HERE, Garmin, OpenStreetMap contributors`,
  },
]

export const BASEMAP_KEYS = BASEMAPS.map((b) => b.key)

export const DEFAULT_BASEMAP = 'light'

/** The definition for a key, falling back to the default rather than to null. */
export function basemapFor(key) {
  return BASEMAPS.find((b) => b.key === key) || BASEMAPS.find((b) => b.key === DEFAULT_BASEMAP)
}

/** A single real tile from this basemap, for the picker's preview image. */
export function basemapPreview(basemap) {
  return basemap.base
    .replace('{z}', PREVIEW_TILE.z)
    .replace('{x}', PREVIEW_TILE.x)
    .replace('{y}', PREVIEW_TILE.y)
}
