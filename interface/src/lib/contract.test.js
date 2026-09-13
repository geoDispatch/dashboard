// The frontend against the canonical contract schemas in ROOT/contracts.
//
// Every ws_update example must pass validateFrame, and every list the console
// keeps of its own — message types, enums, zone bands, sensor limits — must
// equal the schema's. When the contract changes and this console does not,
// this file fails instead of the dashboard quietly dropping real frames.
//
// Read with node:fs + fileURLToPath: the repository path contains a space,
// and URL.pathname would hand back its percent-encoded form.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ACTIONS,
  AFTERSHOCK_RISKS,
  COMPLETE_STATUSES,
  CONGESTION_LEVELS,
  CONTRACT_VERSION,
  DEVICE_STAGES,
  DISASTER_TYPES,
  ERROR_CODES,
  ERROR_STAGES,
  EVENT_ID_MAX_LENGTH,
  EVENT_ID_PATTERN,
  LIFECYCLES,
  MAX_SHELTERS,
  MESSAGE_TYPES,
  NARRATIVE_MAX_LENGTH,
  NETWORK_SOURCES,
  PHONE_RE,
  QOS_STATUSES,
  REACHABILITY_STATUSES,
  RESCUE_STATUSES,
  SHELTERS_STATUSES,
  SMS_GATEWAY_STATES,
  SMS_STATUSES,
  ZONES,
  ZONE_BAND_FALLBACK,
  validateFrame,
} from './validate'
import { SENSOR_FIELDS, SENSOR_LIMITS, validateSensorInput } from './launch'
import { ERROR_SEVERITY, ZONE_RADIUS_THRESHOLDS } from '../constants/zones'

// src/lib → src → interface → dashboard → ROOT
const CONTRACTS = fileURLToPath(new URL('../../../../contracts/examples/', import.meta.url))
const present = existsSync(`${CONTRACTS}ws_update.json`) && existsSync(`${CONTRACTS}sensor_input.json`)

if (!present) {
  console.warn(`[contract.test] SKIPPED: canonical contracts not found at ${CONTRACTS}`)
}

const read = (name) => JSON.parse(readFileSync(`${CONTRACTS}${name}`, 'utf8'))
const sorted = (list) => [...list].sort()

describe.skipIf(!present)('ws_update.json (contract v2)', () => {
  const ws = present ? read('ws_update.json') : null
  const defs = ws?.definitions ?? {}
  const deref = (node) => (node?.$ref ? defs[node.$ref.replace('#/definitions/', '')] : node)
  const frameDefs = (ws?.oneOf ?? []).map(deref)

  it('is contract version 2', () => {
    expect(ws['x-contract-version']).toBe(CONTRACT_VERSION)
    expect(defs.ContractVersion.const).toBe(CONTRACT_VERSION)
  })

  it('every example passes validateFrame', () => {
    expect(ws.examples.length).toBeGreaterThan(0)
    for (const [i, example] of ws.examples.entries()) {
      const r = validateFrame(example)
      expect(r.ok, `example ${i} (${example.type}): ${r.reason}`).toBe(true)
    }
  })

  it('has an example of every message type', () => {
    expect(sorted(new Set(ws.examples.map((e) => e.type)))).toEqual(sorted(MESSAGE_TYPES))
  })

  it('the message types are exactly the schema\'s', () => {
    expect(sorted(frameDefs.map((d) => d.properties.type.const))).toEqual(sorted(MESSAGE_TYPES))
  })

  it('every schema-required envelope and payload field is required by validateFrame', () => {
    for (const example of ws.examples) {
      const def = frameDefs.find((d) => d.properties.type.const === example.type)
      for (const key of def.required) {
        const f = { ...example }
        delete f[key]
        expect(validateFrame(f).ok, `${example.type}.${key}`).toBe(false)
      }
      const payloadDef = deref(def.properties.payload)
      for (const key of payloadDef.required) {
        const payload = { ...example.payload }
        delete payload[key]
        expect(validateFrame({ ...example, payload }).ok, `${example.type}.payload.${key}`).toBe(false)
      }
      // additionalProperties: false on both sides — an extra field is refused.
      expect(validateFrame({ ...example, payload: { ...example.payload, extra_field: 1 } }).ok).toBe(false)
    }
  })

  it('the enum lists equal the schema\'s', () => {
    const pairs = {
      DisasterType:       DISASTER_TYPES,
      AftershockRisk:     AFTERSHOCK_RISKS,
      Zone:               ZONES,
      ReachabilityStatus: REACHABILITY_STATUSES,
      Stage:              DEVICE_STAGES,
      Action:             ACTIONS,
      SmsStatus:          SMS_STATUSES,
      RescueStatus:       RESCUE_STATUSES,
      Lifecycle:          LIFECYCLES,
      CompletionStatus:   COMPLETE_STATUSES,
      ErrorCode:          ERROR_CODES,
      ErrorStage:         ERROR_STAGES,
      CongestionLevel:    CONGESTION_LEVELS,
      QosStatus:          QOS_STATUSES,
      SheltersStatus:     SHELTERS_STATUSES,
      NetworkSource:      NETWORK_SOURCES,
      SmsGateway:         SMS_GATEWAY_STATES,
    }
    for (const [name, ours] of Object.entries(pairs)) {
      expect(sorted(ours), name).toEqual(sorted(defs[name].enum))
    }
    // Every error code has operator wording.
    expect(sorted(Object.keys(ERROR_SEVERITY))).toEqual(sorted(defs.ErrorCode.enum))
  })

  it('the zone-band fallback equals the schema\'s bands', () => {
    const schemaBands = Object.fromEntries(
      Object.entries(defs.ZoneBands.properties).map(([zone, rule]) => [zone, rule.const]),
    )
    expect(ZONE_BAND_FALLBACK).toEqual(schemaBands)
    expect(ZONE_RADIUS_THRESHOLDS).toEqual(schemaBands)
  })

  it('formats and limits equal the schema\'s', () => {
    expect(PHONE_RE.source).toBe(defs.Phone.pattern)
    expect(EVENT_ID_PATTERN.source).toBe(defs.EventId.pattern)
    expect(EVENT_ID_MAX_LENGTH).toBe(defs.EventId.maxLength)
    expect(NARRATIVE_MAX_LENGTH).toBe(defs.NarrativePayload.properties.narrative.maxLength)
    expect(MAX_SHELTERS).toBe(defs.EventContextPayload.properties.shelters.maxItems)
  })
})

describe.skipIf(!present)('sensor_input.json', () => {
  const schema = present ? read('sensor_input.json') : null
  const props = schema?.properties ?? {}
  const coords = schema?.definitions?.Coordinates?.properties ?? {}

  it('the launcher sends exactly the schema\'s fields, all required, nothing else', () => {
    expect(sorted(schema.required)).toEqual(sorted(SENSOR_FIELDS))
    expect(sorted(Object.keys(props))).toEqual(sorted(SENSOR_FIELDS))
    expect(schema.additionalProperties).toBe(false)
  })

  it('the launcher limits equal the schema\'s', () => {
    expect(SENSOR_LIMITS.severity).toEqual({ min: props.severity.minimum, max: props.severity.maximum })
    expect(SENSOR_LIMITS.radius_km).toEqual({ exclusive_min: props.radius_km.exclusiveMinimum, max: props.radius_km.maximum })
    expect(SENSOR_LIMITS.depth_km).toEqual({ min: props.depth_km.minimum, max: props.depth_km.maximum })
    expect(SENSOR_LIMITS.event_id_max_length).toBe(props.event_id.maxLength)
    expect(EVENT_ID_PATTERN.source).toBe(props.event_id.pattern)
    expect(SENSOR_LIMITS.latitude).toEqual({ min: coords.latitude.minimum, max: coords.latitude.maximum })
    expect(SENSOR_LIMITS.longitude).toEqual({ min: coords.longitude.minimum, max: coords.longitude.maximum })
    expect(sorted(DISASTER_TYPES)).toEqual(sorted(props.disaster_type.enum))
    expect(sorted(AFTERSHOCK_RISKS)).toEqual(sorted(props.aftershock_risk.enum))
  })

  it('every example passes validateSensorInput', () => {
    for (const example of schema.examples) {
      expect(validateSensorInput(example)).toEqual({ ok: true, errors: {} })
    }
  })
})
