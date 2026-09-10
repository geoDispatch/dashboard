// Vector basemap styles: colour parsing, theme recolouring, and the 2D guarantee.

import { describe, expect, it } from 'vitest'

import {
  PROFILES,
  formatColor,
  lightness,
  mapColors,
  parseColor,
  prepareStyle,
  profileRemap,
} from './mapStyle'
import {
  BASEMAPS,
  BASEMAP_KEYS,
  OFM_CREDIT,
  basemapFor,
  basemapPreview,
  maxZoomFor,
  profileFor,
} from '../constants/basemaps'

describe('parseColor', () => {
  it('reads every hex form', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#0008')).toEqual([0, 0, 0, 0.533])
    expect(parseColor('#45516E')).toEqual([69, 81, 110, 1])
    expect(parseColor('#00000080')).toEqual([0, 0, 0, 0.502])
  })

  it('reads rgb() and rgba() however they are spaced', () => {
    // OpenFreeMap's dark style really ships this spacing.
    expect(parseColor('rgb(27 ,27 ,29)')).toEqual([27, 27, 29, 1])
    expect(parseColor('rgba(60,60,60,0.8)')).toEqual([60, 60, 60, 0.8])
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5])
  })

  it('reads hsl() and hsla()', () => {
    const [r, g, b, a] = parseColor('hsla(0,0%,85%,0.53)')
    expect([Math.round(r), Math.round(g), Math.round(b), a]).toEqual([217, 217, 217, 0.53])
    const [r2, g2, b2] = parseColor('hsl(232,33%,34%)')
    expect([Math.round(r2), Math.round(g2), Math.round(b2)]).toEqual([58, 66, 115])
  })

  it('knows the common names and nothing else', () => {
    expect(parseColor('black')).toEqual([0, 0, 0, 1])
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0])
    expect(parseColor('water')).toBeNull()
    expect(parseColor('{name:latin}')).toBeNull()
    expect(parseColor('#zzz')).toBeNull()
    expect(parseColor(12)).toBeNull()
  })
})

describe('formatColor', () => {
  it('round-trips through parseColor', () => {
    expect(formatColor([27.4, 27.6, 29, 0.8])).toBe('rgba(27,28,29,0.8)')
    expect(parseColor(formatColor([1, 2, 3, 0.25]))).toEqual([1, 2, 3, 0.25])
  })
})

describe('profileRemap', () => {
  const graphite = profileRemap(PROFILES.graphite)
  const navy = profileRemap(PROFILES.navy)

  it('keeps the lightness order — a road stays lighter than the land it crosses', () => {
    for (const remap of [graphite, navy]) {
      const land = lightness(remap([12, 12, 12, 1]))
      const road = lightness(remap([60, 60, 60, 1]))
      const label = lightness(remap([101, 101, 101, 1]))
      expect(land).toBeLessThan(road)
      expect(road).toBeLessThan(label)
    }
  })

  it('keeps alpha', () => {
    expect(navy([60, 60, 60, 0.8])[3]).toBe(0.8)
  })

  it('lands on the theme colours', () => {
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
    expect(hex(graphite([12, 12, 12, 1]))).toBe('#383b41')   // --gd-map-ground, Dark
    expect(hex(navy([12, 12, 12, 1]))).toBe('#16265a')       // --gd-map-ground, Dark blue
    // Navy is blue: blue channel dominant. Graphite is near-neutral.
    const [r, g, b] = navy([12, 12, 12, 1])
    expect(b).toBeGreaterThan(r + 40)
    const [gr, , gb] = graphite([12, 12, 12, 1])
    expect(Math.abs(gb - gr)).toBeLessThan(12)
  })
})

describe('mapColors', () => {
  it('remaps colours inside expressions and leaves everything else alone', () => {
    const value = ['interpolate', ['linear'], ['zoom'], 5.8, 'hsla(0,0%,85%,0.53)', 6, '#fff']
    // A remap that keeps alpha, as every real profile does.
    const out = mapColors(value, (rgba) => [1, 2, 3, rgba[3]])
    expect(out).toEqual(['interpolate', ['linear'], ['zoom'], 5.8, 'rgba(1,2,3,0.53)', 6, 'rgba(1,2,3,1)'])
  })

  it('walks legacy stops functions', () => {
    const out = mapColors({ stops: [[4, '#000'], [10, '#fff']] }, () => [9, 9, 9, 1])
    expect(out).toEqual({ stops: [[4, 'rgba(9,9,9,1)'], [10, 'rgba(9,9,9,1)']] })
  })

  it('does not touch match labels that are not colours', () => {
    const value = ['match', ['get', 'class'], 'water', '#000', '#fff']
    const out = mapColors(value, () => [5, 5, 5, 1])
    expect(out[1]).toEqual(['get', 'class'])
    expect(out[2]).toBe('water')
    expect(out[3]).toBe('rgba(5,5,5,1)')
  })
})

describe('prepareStyle', () => {
  const style = {
    version: 8,
    projection: { type: 'globe' },
    terrain: { source: 'dem', exaggeration: 1.5 },
    sky: { 'sky-color': '#000' },
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
      { id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': 'rgba(27,27,29,0.9)' } },
      { id: 'building', type: 'fill', paint: { 'fill-color': '#0a0a0a', 'fill-opacity': 0.5 } },
      { id: 'building-3d', type: 'fill-extrusion', paint: { 'fill-extrusion-color': '#111' } },
      { id: 'place', type: 'symbol', layout: { 'text-field': '{name}' }, paint: { 'text-color': 'rgb(101,101,101)' } },
    ],
  }

  it('is strictly 2D: no globe, no terrain, no sky, no extrusions', () => {
    const flat = prepareStyle(style)
    expect(flat.projection).toBeUndefined()
    expect(flat.terrain).toBeUndefined()
    expect(flat.sky).toBeUndefined()
    expect(flat.layers.map((l) => l.id)).toEqual(['background', 'water', 'building', 'place'])
  })

  it('keeps the source colours when no profile is given, and never mutates its input', () => {
    const flat = prepareStyle(style, null)
    expect(flat.layers[0].paint['background-color']).toBe('rgb(12,12,12)')
    expect(style.layers).toHaveLength(5)
    expect(style.projection).toEqual({ type: 'globe' })
  })

  it('recolours paint colours only — not opacity, not layout', () => {
    const navy = prepareStyle(style, 'navy')
    expect(navy.layers[0].paint['background-color']).toBe('rgba(22,38,90,1)')
    expect(navy.layers[2].paint['fill-opacity']).toBe(0.5)
    expect(navy.layers[3].layout['text-field']).toBe('{name}')
  })

  it('pins water to the profile colour, keeping its alpha', () => {
    const graphite = prepareStyle(style, 'graphite')
    const [r, g, b, a] = parseColor(graphite.layers[1].paint['fill-color'])
    expect([r, g, b].map(Math.round)).toEqual(parseColor(PROFILES.graphite.water).slice(0, 3).map(Math.round))
    expect(a).toBe(0.9)
  })

  it('ignores an unknown profile', () => {
    expect(prepareStyle(style, 'neon').layers[0].paint['background-color']).toBe('rgb(12,12,12)')
  })
})

describe('basemaps', () => {
  it('keeps the four keys settings already store', () => {
    expect(BASEMAP_KEYS).toEqual(['dark', 'light', 'satellite', 'streets'])
  })

  it('draws every map but satellite as vector, and every map has a raster fallback', () => {
    for (const b of BASEMAPS) {
      expect(b.raster.base).toMatch(/^https:\/\/server\.arcgisonline\.com\//)
      if (b.key === 'satellite') expect(b.vector).toBeNull()
      else expect(b.vector.style).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//)
    }
  })

  it('credits OpenFreeMap, OpenMapTiles and OpenStreetMap', () => {
    expect(OFM_CREDIT).toContain('OpenFreeMap')
    expect(OFM_CREDIT).toContain('OpenMapTiles')
    expect(OFM_CREDIT).toContain('OpenStreetMap')
  })

  it('caps zoom by what the renderer can actually draw', () => {
    expect(maxZoomFor(basemapFor('dark'), 'vector')).toBe(19)
    expect(maxZoomFor(basemapFor('dark'), 'raster')).toBe(16)      // Esri grey canvas stops at 16
    expect(maxZoomFor(basemapFor('satellite'), 'vector')).toBe(19) // no vector: raster cap
  })

  it('recolours only the dark canvas, graphite everywhere and navy in Dark blue', () => {
    expect(profileFor(basemapFor('dark'), 'light')).toBe('graphite')
    expect(profileFor(basemapFor('dark'), 'dark')).toBe('graphite')
    expect(profileFor(basemapFor('dark'), 'dark-blue')).toBe('navy')
    for (const key of ['light', 'streets', 'satellite']) {
      expect(profileFor(basemapFor(key), 'dark-blue')).toBeNull()
    }
  })

  it('previews raster basemaps with one real tile', () => {
    expect(basemapPreview(basemapFor('satellite'))).toMatch(/World_Imagery\/MapServer\/tile\/11\/837\/976$/)
  })
})
