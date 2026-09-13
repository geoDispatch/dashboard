import { describe, expect, it } from 'vitest'

import {
  _DICTIONARIES,
  agoText,
  enumLabel,
  hasKey,
  makeT,
  reachabilityText,
  severityText,
  t,
  tFor,
} from './i18n'
import {
  ACTION_LABELS,
  DASH,
  LIFECYCLE_LABELS,
  RESCUE_STATUS_LABELS,
  SMS_STATUS_LABELS,
  STAGE_LABELS,
  ago,
  reachabilityLabel,
  severityLabel,
} from './format'
import { ERROR_SEVERITY, ZONE_LABELS, ZONE_MEANING } from '../constants/zones'

const { en, ar } = _DICTIONARIES
const placeholders = (text) => [...text.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort()

describe('dictionaries', () => {
  it('has an Arabic string for every English key, and no extra ones', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
  })

  it('uses the same placeholders in both languages', () => {
    for (const key of Object.keys(en)) {
      expect(placeholders(ar[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('leaves no string empty', () => {
    for (const dict of [en, ar]) {
      for (const [key, text] of Object.entries(dict)) expect(text.trim(), key).not.toBe('')
    }
  })
})

describe('t', () => {
  it('interpolates by position, in whatever order the language needs', () => {
    const args = ['SIM-1', 'M 6.8', 'زلزال', '31.0600, -8.3800', '40.0 km']
    expect(t('app.replayTitle', 'en', ...args)).toBe(
      'Run SIM-1 again: M 6.8 زلزال, 31.0600, -8.3800, 40.0 km radius',
    )
    expect(t('app.replayTitle', 'ar', ...args)).toBe(
      'تشغيل SIM-1 مرة أخرى: زلزال M 6.8، 31.0600, -8.3800، نصف القطر 40.0 km',
    )
  })

  it('never reads a placeholder out of an argument', () => {
    expect(t('app.noteNoRegion', 'en', '{0}')).toBe('No region named {0} is on the list.')
  })

  it('falls back to English for a language with no dictionary', () => {
    expect(t('topbar.launch', 'fr')).toBe('Launch incident')
  })

  it('shows a missing key rather than nothing', () => {
    expect(t('no.such.key', 'ar')).toBe('no.such.key')
    expect(hasKey('no.such.key')).toBe(false)
  })

  it('makeT follows the store as the language changes', () => {
    const store = { settings: { language: 'en' } }
    const tr = makeT(store)
    expect(tr('zone.red')).toBe('Red zone')
    store.settings.language = 'ar'
    expect(tr('zone.red')).toBe('المنطقة الحمراء')
    expect(tr.lang()).toBe('ar')
    expect(makeT(null)('zone.red')).toBe('Red zone')
  })
})

// The English dictionary repeats wording that also lives in lib/format.js and
// constants/zones.js. These hold the copies equal, so changing one and
// forgetting the other fails here instead of drifting apart on screen.
describe('English matches the labels it replaces', () => {
  const tEn = tFor('en')

  const same = (group, table) => {
    for (const [value, words] of Object.entries(table)) {
      expect(enumLabel(tEn, group, value), `${group}.${value}`).toBe(words)
    }
  }

  it('device and incident enums', () => {
    same('stage', STAGE_LABELS)
    same('sms', SMS_STATUS_LABELS)
    same('rescueStatus', RESCUE_STATUS_LABELS)
    same('action', ACTION_LABELS)
    same('lifecycle', LIFECYCLE_LABELS)
  })

  it('zones and error codes', () => {
    same('zone', ZONE_LABELS)
    same('zoneMeaning', ZONE_MEANING)
    for (const [code, entry] of Object.entries(ERROR_SEVERITY)) {
      expect(tEn(`error.${code}`), code).toBe(entry.reads)
    }
  })

  it('renders null and unknown values as a dash', () => {
    expect(enumLabel(tEn, 'stage', null)).toBe(DASH)
    expect(enumLabel(tEn, 'stage', 'nonsense')).toBe(DASH)
    expect(enumLabel(tEn, 'risk', 'EXTREME', 'Extreme')).toBe('Extreme')
  })

  it('reachability, assumed or not', () => {
    const devices = [
      null,
      {},
      { reachability_status: 'CONNECTED_DATA' },
      { reachability_status: 'CONNECTED_SMS' },
      { reachability_status: 'NOT_CONNECTED', reachability_assumed: true },
      { reachability_status: 'SOMETHING_NEW' },
    ]
    for (const device of devices) {
      expect(reachabilityText(tEn, device)).toBe(reachabilityLabel(device))
    }
  })

  it('severity, per disaster type', () => {
    for (const type of ['earthquake', 'flood', 'heatwave', 'volcano']) {
      expect(severityText(tEn, type, 6.84)).toBe(severityLabel(type, 6.84))
    }
    expect(severityText(tEn, 'earthquake', null)).toBe(severityLabel('earthquake', null))
  })

  it('relative time', () => {
    const now = 50_000_000
    for (const seconds of [0, 1, 2, 5, 59, 60, 61, 3599, 3600, 7322]) {
      const at = now - seconds * 1000
      expect(agoText(tEn, at, now), `${seconds}s`).toBe(ago(at, now))
    }
    expect(agoText(tEn, 0, now)).toBe(ago(0, now))
  })
})

describe('Arabic', () => {
  const tAr = tFor('ar')

  it('translates the enums the panels show', () => {
    expect(enumLabel(tAr, 'zone', 'red')).toBe('المنطقة الحمراء')
    expect(enumLabel(tAr, 'action', 'sms')).toBe('إرسال رسالة قصيرة')
    expect(reachabilityText(tAr, { reachability_status: 'NOT_CONNECTED', reachability_assumed: true }))
      .toBe('غير متصل (مفترض — فشل الاستعلام)')
  })

  it('keeps the magnitude notation and translates the other severities', () => {
    expect(severityText(tAr, 'earthquake', 6.8)).toBe('M 6.8')
    expect(severityText(tAr, 'flood', 3)).toBe('شدة الفيضان 3.0')
  })
})
