// Theme resolution and the basemap that follows it.

import { describe, expect, it } from 'vitest'

import {
  NIGHT_THEMES,
  THEMES,
  THEME_PREFS,
  applyTheme,
  basemapForTheme,
  isDarkTheme,
  resolveTheme,
} from './theme'
import { createSettingsStore } from './settings'

describe('theme lists', () => {
  it('offers Light, Dark and Dark blue, plus system', () => {
    expect(THEMES).toEqual(['light', 'dark', 'dark-blue'])
    expect(NIGHT_THEMES).toEqual(['dark', 'dark-blue'])
    expect(THEME_PREFS).toEqual(['light', 'dark', 'dark-blue', 'system'])
  })
})

describe('isDarkTheme', () => {
  it('is true for both dark themes and nothing else', () => {
    expect(isDarkTheme('dark')).toBe(true)
    expect(isDarkTheme('dark-blue')).toBe(true)
    expect(isDarkTheme('light')).toBe(false)
    expect(isDarkTheme('system')).toBe(false)
    expect(isDarkTheme(undefined)).toBe(false)
  })
})

describe('resolveTheme', () => {
  it('honours an explicit choice whatever the OS says', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('dark-blue', false)).toBe('dark-blue')
    // …and whatever the night theme is.
    expect(resolveTheme('dark', true, 'dark-blue')).toBe('dark')
  })

  it('follows the OS only when asked to: light by day, the night theme by night', () => {
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', false, 'dark-blue')).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', true, 'dark')).toBe('dark')
    expect(resolveTheme('system', true, 'dark-blue')).toBe('dark-blue')
  })

  it('never paints an unknown night theme — it falls back to Dark', () => {
    expect(resolveTheme('system', true, 'light')).toBe('dark')
    expect(resolveTheme('system', true, 'neon')).toBe('dark')
  })

  it('treats anything unrecognised as the system preference', () => {
    expect(resolveTheme(undefined, false)).toBe('light')
    expect(resolveTheme('banana', true)).toBe('dark')
    expect(resolveTheme('banana', true, 'dark-blue')).toBe('dark-blue')
  })
})

describe('basemapForTheme', () => {
  it('swaps the grey canvas to match the theme', () => {
    expect(basemapForTheme('light', 'dark')).toBe('dark')
    expect(basemapForTheme('light', 'dark-blue')).toBe('dark')
    expect(basemapForTheme('dark', 'light')).toBe('light')
  })

  it('leaves a basemap alone when it already matches', () => {
    expect(basemapForTheme('dark', 'dark')).toBeNull()
    expect(basemapForTheme('dark', 'dark-blue')).toBeNull()   // both darks share the canvas
    expect(basemapForTheme('light', 'light')).toBeNull()
  })

  it('never touches satellite or streets — those are about content, not colour', () => {
    for (const theme of THEMES) {
      expect(basemapForTheme('satellite', theme)).toBeNull()
      expect(basemapForTheme('streets', theme)).toBeNull()
    }
  })
})

describe('applyTheme', () => {
  it('stamps one of the three themes on the document, and light for anything else', () => {
    const doc = { documentElement: { dataset: {} } }
    applyTheme('dark', doc)
    expect(doc.documentElement.dataset.theme).toBe('dark')
    applyTheme('dark-blue', doc)
    expect(doc.documentElement.dataset.theme).toBe('dark-blue')
    applyTheme('system', doc)   // a preference, not a theme — never painted as-is
    expect(doc.documentElement.dataset.theme).toBe('light')
    applyTheme('anything', doc)
    expect(doc.documentElement.dataset.theme).toBe('light')
  })

  it('is a no-op without a document', () => {
    expect(() => applyTheme('dark', null)).not.toThrow()
  })
})

describe('theme settings', () => {
  // localStorage does not exist in node; the store must still work without it.
  it('theme defaults to light, and rejects values it does not know', () => {
    const store = createSettingsStore()
    expect(store.settings.theme).toBe('light')

    for (const pref of THEME_PREFS) {
      store.set('theme', pref)
      expect(store.settings.theme).toBe(pref)
    }

    store.set('theme', 'neon')
    expect(store.settings.theme).toBe('light')   // falls back to the default
  })

  it('night theme defaults to Dark and only accepts a dark theme', () => {
    const store = createSettingsStore()
    expect(store.settings.nightTheme).toBe('dark')

    store.set('nightTheme', 'dark-blue')
    expect(store.settings.nightTheme).toBe('dark-blue')

    store.set('nightTheme', 'light')             // light is not a night theme
    expect(store.settings.nightTheme).toBe('dark')

    store.set('nightTheme', 'system')
    expect(store.settings.nightTheme).toBe('dark')
  })
})
