// Light, Dark, Dark blue — or whatever the operating system says.
//
// The preference is stored; the RESOLVED theme is what reaches the page, as
// <html data-theme="light|dark|dark-blue">. tokens.css keys every themed colour
// off that attribute, so this module is the whole of the theme switch: nothing
// else in the console knows or cares which theme is on, beyond asking
// isDarkTheme().

/** The themes that can actually be painted. */
export const THEMES = ['light', 'dark', 'dark-blue']

/** The themes 'system' may pick from when the OS is in dark mode. */
export const NIGHT_THEMES = ['dark', 'dark-blue']

/** What may be stored: a theme, or 'system' to follow the OS. */
export const THEME_PREFS = [...THEMES, 'system']

/** True for both dark themes. They share a basemap and a band opacity. */
export const isDarkTheme = (theme) => NIGHT_THEMES.includes(theme)

/**
 * 'light' | 'dark' | 'dark-blue' — what is actually painted.
 *
 * An explicit theme always wins. Anything else follows the OS: light by day,
 * and the operator's chosen night theme by night.
 */
export function resolveTheme(pref, systemPrefersDark, nightTheme = 'dark') {
  if (THEMES.includes(pref)) return pref
  if (!systemPrefersDark) return 'light'
  return NIGHT_THEMES.includes(nightTheme) ? nightTheme : 'dark'
}

/**
 * The basemap that goes with a theme change, or null to leave it alone.
 *
 * Only the two grey canvases follow the theme. A light canvas inside a dark
 * console is the brightest object in the room; a dark one inside a light
 * console reads as a hole. Both dark themes use the dark canvas (Dark blue
 * tints it in CSS). Satellite and streets are deliberate choices about WHAT
 * the operator wants to see, not about colour, so they are never touched.
 */
export function basemapForTheme(currentBasemap, resolvedTheme) {
  const dark = isDarkTheme(resolvedTheme)
  if (dark && currentBasemap === 'light') return 'dark'
  if (!dark && currentBasemap === 'dark') return 'light'
  return null
}

/** Stamp the resolved theme on the document. Safe to call outside a browser. */
export function applyTheme(resolved, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return
  doc.documentElement.dataset.theme = THEMES.includes(resolved) ? resolved : 'light'
}

/** matchMedia for the OS preference, or a stub where there is none. */
export function systemDarkQuery(win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.matchMedia !== 'function') {
    return { matches: false, addEventListener() {}, removeEventListener() {} }
  }
  return win.matchMedia('(prefers-color-scheme: dark)')
}
