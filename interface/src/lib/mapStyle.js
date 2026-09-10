// Vector basemap styles: made strictly 2D, and recoloured to the console's
// theme. Pure functions over MapLibre style JSON — no DOM, no MapLibre import —
// so the vector engine itself can stay lazily loaded and this file stays
// testable in node.
//
// ── Why recolour the style instead of filtering the canvas ──────────────────
// The raster Dark blue map was a CSS filter over the tile pane. On a WebGL
// canvas that redraws every frame of a pan or zoom, a filter chain is
// re-applied every frame too — exactly the smoothness the vector engine is
// there to buy. Rewriting the style's own colours costs nothing at render
// time, keeps text crisp, and gives exact theme colours instead of an
// approximation.

// ── colours ──────────────────────────────────────────────────────────────────

const NAMED = {
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  transparent: [0, 0, 0, 0],
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * A CSS colour string as [r, g, b, a] (0–255, alpha 0–1), or null if the
 * string is not a colour. Covers what style JSON actually contains: #rgb,
 * #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with commas or spaces (OpenFreeMap
 * ships "rgb(27 ,27 ,29)"), hsl()/hsla(), and the three common names.
 */
export function parseColor(input) {
  if (typeof input !== 'string') return null
  const s = input.trim().toLowerCase()

  if (NAMED[s]) return [...NAMED[s]]

  if (s[0] === '#') {
    const hex = s.slice(1)
    if (!/^[0-9a-f]+$/.test(hex)) return null
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = 'f'] = hex
      return [
        parseInt(r + r, 16),
        parseInt(g + g, 16),
        parseInt(b + b, 16),
        Math.round((parseInt(a + a, 16) / 255) * 1000) / 1000,
      ]
    }
    if (hex.length === 6 || hex.length === 8) {
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        Math.round(a * 1000) / 1000,
      ]
    }
    return null
  }

  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(s)
  if (!fn) return null
  const parts = fn[2].match(/-?\d*\.?\d+(?:e-?\d+)?%?/g)
  if (!parts || parts.length < 3) return null
  const num = (p) => parseFloat(p)
  const alpha = parts[3] === undefined
    ? 1
    : clamp(parts[3].endsWith('%') ? num(parts[3]) / 100 : num(parts[3]), 0, 1)

  if (fn[1].startsWith('rgb')) {
    const channel = (p) => clamp(p.endsWith('%') ? (num(p) / 100) * 255 : num(p), 0, 255)
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha]
  }

  const [r, g, b] = hslToRgb(num(parts[0]), num(parts[1]) / 100, num(parts[2]) / 100)
  return [r, g, b, alpha]
}

/** [r, g, b, a] → "rgba(r,g,b,a)", channels rounded. */
export function formatColor([r, g, b, a = 1]) {
  const alpha = Math.round(clamp(a, 0, 1) * 1000) / 1000
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`
}

/** h in degrees, s and l 0–1 → [r, g, b] 0–255. */
export function hslToRgb(h, s, l) {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]
}

/** HSL lightness, 0–1. */
export function lightness([r, g, b]) {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  return (max + min) / 2
}

// ── recolour profiles ─────────────────────────────────────────────────────────
//
// Both are for the dark canvas (OpenFreeMap "dark"), which is monochrome: land
// is 12/255 grey, roads 24–60, labels 101. Every colour keeps its alpha and its
// place in the lightness order — a road stays lighter than the land it
// crosses, a label lighter than the road — and is re-expressed in the theme's
// hue at a lifted lightness:
//
//   L' = lMin + L × lScale,   saturation easing from satDark to satLight as L' rises
//
// Water is the one deliberate exception. The source draws the sea slightly
// LIGHTER than land; both profiles pin it darker, as the Esri canvas the
// console used before did, so a coastline reads the way operators expect.

export const PROFILES = {
  // Dark theme: the neutral, slightly cool graphite of the console's cards —
  // land ≈ #36393F, close to the Esri dark grey canvas it replaces.
  graphite: {
    hue: 220,
    satDark: 0.07,
    satLight: 0.06,
    lMin: 0.19,
    lScale: 1,
    water: 'hsl(220, 10%, 14%)',
  },
  // Dark blue theme: the frame's hue, stepped down — land ≈ #16275A, the sea
  // ≈ #09143A, labels a pale periwinkle that clears 3.9:1 on the land.
  navy: {
    hue: 226,
    satDark: 0.62,
    satLight: 0.38,
    lMin: 0.17,
    lScale: 1.05,
    water: 'hsl(228, 70%, 12%)',
  },
}

/** A function remapping one [r,g,b,a] through a profile. */
export function profileRemap(profile) {
  return (rgba) => {
    const l = clamp(profile.lMin + lightness(rgba) * profile.lScale, 0, 1)
    // Saturation eases off as colours get lighter, so labels come out a pale
    // tint of the hue rather than a loud mid-blue.
    const t = clamp((l - profile.lMin) / Math.max(1e-6, 1 - profile.lMin), 0, 1)
    const s = profile.satDark + (profile.satLight - profile.satDark) * t
    const [r, g, b] = hslToRgb(profile.hue, s, l)
    return [r, g, b, rgba[3]]
  }
}

/**
 * Walk a paint value — a colour string, or an expression / legacy stops
 * function containing colour strings anywhere inside it — and remap every
 * colour. Anything that is not a colour (field names, match labels, numbers)
 * is returned untouched.
 */
export function mapColors(value, remap) {
  if (typeof value === 'string') {
    const rgba = parseColor(value)
    return rgba ? formatColor(remap(rgba)) : value
  }
  if (Array.isArray(value)) return value.map((v) => mapColors(v, remap))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = mapColors(v, remap)
    return out
  }
  return value
}

const isWaterLayer = (layer) =>
  layer['source-layer'] === 'water' || layer['source-layer'] === 'waterway'

// ── the style ─────────────────────────────────────────────────────────────────

/**
 * A copy of a MapLibre style that is guaranteed flat, optionally recoloured.
 *
 * 2D only: the console has no use for a globe, terrain, sky or extruded
 * buildings, and Leaflet — which owns the camera — never pitches or rotates.
 * So `projection`, `terrain` and `sky` are removed (MapLibre then draws plain
 * Web Mercator), and fill-extrusion layers are dropped; flat building
 * footprints, where the style has them, stay.
 *
 * `profile` is a key of PROFILES, or null to keep the style's own colours.
 */
export function prepareStyle(style, profile = null) {
  const next = JSON.parse(JSON.stringify(style))
  delete next.projection
  delete next.terrain
  delete next.sky

  next.layers = (next.layers || []).filter((layer) => layer.type !== 'fill-extrusion')

  const spec = profile ? PROFILES[profile] : null
  if (!spec) return next

  const remap = profileRemap(spec)
  const water = parseColor(spec.water)

  for (const layer of next.layers) {
    if (!layer.paint) continue
    for (const key of Object.keys(layer.paint)) {
      if (!key.endsWith('color')) continue
      // The sea and rivers are pinned, not remapped — see PROFILES. Their
      // alpha (and any zoom-driven alpha) is kept by remapping to the pin.
      if (isWaterLayer(layer) && (key === 'fill-color' || key === 'line-color')) {
        layer.paint[key] = mapColors(layer.paint[key], (rgba) => [water[0], water[1], water[2], rgba[3]])
        continue
      }
      layer.paint[key] = mapColors(layer.paint[key], remap)
    }
  }
  return next
}
