// Operator settings — one small store, persisted to this browser.
//
// Everything here is a DISPLAY preference. Nothing in this file changes what
// the pipeline does, what the AI decides, or what is dispatched; the console
// observes and this decides how it draws what it sees.
//
// Two rules the store enforces rather than trusts:
//
//   1. Every value read back from localStorage is validated against the
//      defaults before it reaches the UI. A hand-edited or half-written blob
//      gives you the default for that one key, never a broken console.
//   2. `privacyMasked` is pinned on. The settings screen shows the control for
//      an authorised full-PII view because the product needs to answer for it,
//      but this console has no credential service to check anyone against, so
//      the switch cannot be thrown from the UI or from storage. See maskedPhone
//      below for the one line that would change if a real one were wired.

import { createContext, useContext } from 'solid-js'
import { createStore, produce } from 'solid-js/store'

import { WS_URL } from '../constants/zones'
import { BASEMAP_KEYS, DEFAULT_BASEMAP } from '../constants/basemaps'
import { coords, distance, dms, maskPhone } from './format'
import { NIGHT_THEMES, THEME_PREFS } from './theme'

const STORAGE_KEY = 'geodispatch.settings.v1'

export const LANGUAGES = [
  { key: 'en', label: 'English',  native: 'English',  locale: 'en-GB', rtl: false },
  { key: 'fr', label: 'French',   native: 'Français', locale: 'fr-MA', rtl: false },
  // Morocco writes its numerals in Latin digits, so ar-MA is the correct tag
  // here — plain 'ar' would switch the console to Arabic-Indic digits.
  { key: 'ar', label: 'Arabic',   native: 'العربية',  locale: 'ar-MA', rtl: true },
]

export const INTERFACE_SCALES = [0.75, 0.9, 1, 1.1]

export const DEFAULT_SETTINGS = {
  // display
  theme: 'light',           // light | dark | dark-blue | system
  nightTheme: 'dark',       // dark | dark-blue — what 'system' paints at night
  basemap: DEFAULT_BASEMAP,
  interfaceScale: 0.75,     // compact by default; adjustable in Display

  // sound
  rescueChime: true,
  fatalAlarm: true,
  volume: 0.8,

  // stream
  wsUrl: WS_URL,

  // localisation and privacy
  language: 'en',
  coordFormat: 'decimal',   // decimal | dms
  units: 'km',              // km | mi
  privacyMasked: true,      // pinned — see the file header

  // station profile. Placeholder values, editable, and stored nowhere but here.
  operator: {
    name:   'Command Officer Ayoub',
    agency: 'Direction Générale de la Protection Civile (DGPC)',
    role:   'Lead Crisis Dispatcher & Triage Supervisor',
    sector: 'Casablanca-Settat / Al Haouz Region',
    badge:  '#MA-DISPATCH-04',
  },
}

// ── validation ──────────────────────────────────────────────────────────────

const oneOf = (list) => (value, fallback) => (list.includes(value) ? value : fallback)
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

const unitFloat = (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback

// A socket URL the browser will actually open. Anything else keeps the default
// rather than leaving the console pointed at a string that can never connect.
export function isWsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:'
  } catch {
    return false
  }
}

const text = (value, fallback, max = 120) =>
  typeof value === 'string' ? value.slice(0, max) : fallback

const VALIDATORS = {
  theme:       oneOf(THEME_PREFS),
  nightTheme:  oneOf(NIGHT_THEMES),
  basemap:     oneOf(BASEMAP_KEYS),
  interfaceScale: oneOf(INTERFACE_SCALES),
  rescueChime: bool,
  fatalAlarm:  bool,
  volume:      unitFloat,
  wsUrl:       (value, fallback) => (isWsUrl(value) ? value.trim() : fallback),
  language:    oneOf(LANGUAGES.map((l) => l.key)),
  coordFormat: oneOf(['decimal', 'dms']),
  units:       oneOf(['km', 'mi']),
}

function sanitise(saved) {
  const next = { ...DEFAULT_SETTINGS, operator: { ...DEFAULT_SETTINGS.operator } }
  if (!saved || typeof saved !== 'object') return next

  for (const [key, validate] of Object.entries(VALIDATORS)) {
    next[key] = validate(saved[key], DEFAULT_SETTINGS[key])
  }

  if (saved.operator && typeof saved.operator === 'object') {
    for (const field of Object.keys(DEFAULT_SETTINGS.operator)) {
      next.operator[field] = text(saved.operator[field], DEFAULT_SETTINGS.operator[field])
    }
  }

  // Not read from storage. Masking is not a preference this console can be
  // talked out of.
  next.privacyMasked = true
  return next
}

// localStorage throws outright in some privacy modes rather than returning
// null, so every touch of it is guarded and a failure is simply "no settings".
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return sanitise(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitise(null)
  }
}

function writeStored(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

// ── store ───────────────────────────────────────────────────────────────────

export function createSettingsStore() {
  const [settings, setSettings] = createStore(readStored())

  // Whether the last write actually landed. A console in a locked-down browser
  // still works for this session; it just cannot remember anything, and the
  // settings screen says so instead of quietly forgetting.
  let persists = writeStored(settings)

  const persist = () => { persists = writeStored(settings) }

  return {
    settings,
    canPersist: () => persists,

    set(key, value) {
      const validate = VALIDATORS[key]
      if (!validate) return
      setSettings(key, validate(value, DEFAULT_SETTINGS[key]))
      persist()
    },

    setOperator(field, value) {
      if (!(field in DEFAULT_SETTINGS.operator)) return
      setSettings('operator', field, text(value, ''))
      persist()
    },

    /** End of shift: forget this station's profile and preferences. */
    reset() {
      setSettings(produce((s) => {
        Object.assign(s, DEFAULT_SETTINGS)
        s.operator = { ...DEFAULT_SETTINGS.operator }
      }))
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* nothing stored to remove */
      }
      persists = writeStored(settings)
    },
  }
}

// ── context ─────────────────────────────────────────────────────────────────
//
// Coordinates, distances and phone numbers are drawn in half a dozen
// components. Threading four props through all of them would be four chances
// to forget one, so the formatters come from context instead and every screen
// is guaranteed to agree.

// Exported rather than wrapped in a <Provider> component, so this file stays
// plain JavaScript — everything else in lib/ is, and lib/ is the half of the
// app that has to be testable without a renderer.
export const SettingsContext = createContext(null)

export function useSettings() {
  return useContext(SettingsContext)
}

/**
 * Formatters bound to a settings store. Call them inside JSX or inside an
 * accessor — each one reads the store, so changing a preference updates every
 * screen already on the page.
 *
 * Components use useDisplay(); the shell that OWNS the store calls this
 * directly, because a component cannot read a context it is itself providing.
 */
export function makeDisplay(store) {
  const current = () => (store ? store.settings : DEFAULT_SETTINGS)

  return {
    /**
     * A phone number, always masked.
     *
     * This is the single place the console turns a stored E.164 number into
     * pixels. If a credential service is ever wired up, an authorised full
     * view is this one line — and nothing else in the codebase needs to know.
     */
    phone: (value) => maskPhone(value),

    coords: (lat, lng) =>
      current().coordFormat === 'dms' ? dms(lat, lng) : coords(lat, lng),

    distance: (valueKm, places = 1) =>
      distance(valueKm, { units: current().units, places }),

    /** "0–17 km" / "0–11 mi" — a zone's distance band from the epicentre. */
    band: (zone, radiusKm) => {
      if (!radiusKm) return ''
      const lo = zone === 'red' ? 0 : zone === 'orange' ? radiusKm * 0.33 : radiusKm * 0.66
      const hi = zone === 'red' ? radiusKm * 0.33 : zone === 'orange' ? radiusKm * 0.66 : radiusKm
      const unit = current().units === 'mi' ? 'mi' : 'km'
      const scale = current().units === 'mi' ? 0.621371 : 1
      return `${Math.round(lo * scale)}–${Math.round(hi * scale)} ${unit}`
    },

    units: () => current().units,
    coordFormat: () => current().coordFormat,
    language: () => current().language,
  }
}

export function useDisplay() {
  return makeDisplay(useContext(SettingsContext))
}
