// Ingestion: what the supervisor sends, and what the console ends up holding.
//
// These run the REAL router against the REAL store, so nothing here can pass
// because a test double behaved. The one thing that is faked is the clock.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import { createConsoleStore } from './store'
import { routeMessage } from './router'

const EVENT = 'AL-HAOUZ-01'
const OTHER = 'CASA-99'

const envelope = (type, payload, event_id = EVENT, timestamp = 0) => ({
  type, event_id, timestamp, payload,
})

const EVENT_START = {
  disaster_type: 'earthquake',
  severity: 6.8,
  epicenter: { latitude: 31.0625, longitude: -8.4144 },
  radius_km: 50,
  tsunami_risk: false,
  aftershock_risk: 'HIGH',
}

const device = (over = {}) => ({
  phone: '+212612345678',
  latitude: 31.06,
  longitude: -8.41,
  zone: 'red',
  reachable: true,
  sms_sent: false,
  rescue_flag: false,
  ...over,
})

function harness() {
  const { state, actions } = createConsoleStore()
  const send = (msg) => routeMessage(actions, msg)
  return { state, actions, send }
}

describe('router — every supported message type', () => {
  it('accepts all five and rejects anything else', () => {
    const { state, send } = harness()

    expect(send(envelope('event_start', EVENT_START)).ok).toBe(true)
    expect(send(envelope('device_update', device())).ok).toBe(true)
    expect(send(envelope('zone_summary', { red_total: 1, red_reachable: 1, red_rescue: 0 })).ok).toBe(true)
    expect(send(envelope('narrative_update', { zone: 'red', narrative: 'Red zone: 1 device.' })).ok).toBe(true)
    expect(send(envelope('error', { code: 'CAMARA_TIMEOUT', message: 'timeout', phone: '', fatal: false })).ok).toBe(true)

    expect(state.event.disaster_type).toBe('earthquake')
    expect(Object.keys(state.devices)).toHaveLength(1)
    expect(state.summary.red_total).toBe(1)
    expect(state.narratives.red.text).toBe('Red zone: 1 device.')
    expect(state.errors).toHaveLength(1)

    const unknown = send(envelope('device_removed', {}))
    expect(unknown.ok).toBe(false)
    expect(unknown.reason).toMatch(/unknown message type/)
  })

  it('rejects malformed frames without touching the store', () => {
    const { state, send } = harness()
    expect(send(null).ok).toBe(false)
    expect(send({}).ok).toBe(false)
    expect(send(envelope('device_update', { latitude: 1 })).ok).toBe(false)   // no phone
    expect(send(envelope('event_start', { severity: 6 })).ok).toBe(false)     // no epicenter
    expect(state.event).toBeNull()
    expect(Object.keys(state.devices)).toHaveLength(0)
  })
})

describe('device_update — the second frame replaces the first', () => {
  it('applies dispatch values over triage values for the same phone', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))

    // Triage: located, no decision yet.
    send(envelope('device_update', device({ zone: 'red', reachable: false })))
    expect(state.devices['+212612345678'].sms_sent).toBe(false)
    expect(state.devices['+212612345678'].rescue_flag).toBe(false)

    // Dispatch: same phone, decision applied.
    send(envelope('device_update', device({
      zone: 'red', reachable: false, sms_sent: false, rescue_flag: true,
    })))

    const after = state.devices['+212612345678']
    expect(Object.keys(state.devices)).toHaveLength(1)   // merged, never appended
    expect(after.rescue_flag).toBe(true)
    expect(after.reachable).toBe(false)
  })

  it('keeps every incoming value exactly as sent, and invents nothing', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))

    const sent = {
      phone: '+212698765432',
      latitude: 31.08912,
      longitude: -8.39721,
      zone: 'orange',
      reachable: false,
      sms_sent: true,
      rescue_flag: true,
    }
    send(envelope('device_update', sent))

    const held = state.devices['+212698765432']
    for (const [key, value] of Object.entries(sent)) {
      expect(held[key]).toBe(value)
    }

    // Nothing the supervisor did not send has appeared with a value.
    for (const invented of [
      'shelter_name', 'rescue_priority', 'confidence', 'sms_message',
      'location_radius_m', 'reachability_status', 'distance_km',
    ]) {
      expect(held[invented]).toBeUndefined()
    }
  })

  it('an orange-zone device can carry a rescue flag', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('device_update', device({ phone: '+212600000001', zone: 'orange', rescue_flag: true })))
    expect(state.devices['+212600000001'].rescue_flag).toBe(true)
    expect(state.devices['+212600000001'].zone).toBe('orange')
  })
})

describe('event_id — incidents never merge', () => {
  it('drops frames belonging to a different incident and counts them', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('device_update', device({ phone: '+212600000001' })))

    // A straggler from the previous incident.
    send(envelope('device_update', device({ phone: '+212600000002' }), OTHER))
    send(envelope('zone_summary', { red_total: 999 }, OTHER))
    send(envelope('narrative_update', { zone: 'green', narrative: 'wrong incident' }, OTHER))
    send(envelope('error', { code: 'SMS_FAILED', message: 'wrong incident' }, OTHER))

    expect(Object.keys(state.devices)).toEqual(['+212600000001'])
    expect(state.summary).toBeNull()
    expect(state.narratives.green).toBeUndefined()
    expect(state.errors).toHaveLength(0)
    expect(state.dropped.foreign).toBe(4)
    expect(state.dropped.lastId).toBe(OTHER)
  })

  it('a new event_start replaces the incident instead of merging into it', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('device_update', device({ phone: '+212600000001' })))

    send(envelope('event_start', { ...EVENT_START, severity: 6.2 }, OTHER))
    expect(state.activeEventId).toBe(OTHER)
    expect(Object.keys(state.devices)).toHaveLength(0)
    expect(state.dropped.foreign).toBe(0)

    send(envelope('device_update', device({ phone: '+212600000009' }), OTHER))
    expect(Object.keys(state.devices)).toEqual(['+212600000009'])
  })

  it('a device before event_start is a late join, not an invented event', () => {
    const { state, send } = harness()
    send(envelope('device_update', device({ phone: '+212600000001' })))

    expect(state.joinedLate).toBe(true)
    expect(state.activeEventId).toBe(EVENT)
    expect(state.event).toBeNull()          // no epicentre was sent, so none is held
    expect(Object.keys(state.devices)).toHaveLength(1)

    // Later frames of the SAME incident are accepted...
    send(envelope('device_update', device({ phone: '+212600000002' })))
    expect(Object.keys(state.devices)).toHaveLength(2)
    // ...and a different one is still refused.
    send(envelope('device_update', device({ phone: '+212600000003' }), OTHER))
    expect(Object.keys(state.devices)).toHaveLength(2)
    expect(state.dropped.foreign).toBe(1)
  })

  it('accepts a frame with no event_id rather than guessing it is foreign', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('device_update', device({ phone: '+212600000001' }), undefined))
    expect(Object.keys(state.devices)).toHaveLength(1)
    expect(state.dropped.foreign).toBe(0)
  })
})

describe('fatal errors', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('records the halt on the pipeline, not on the connection', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('error', { code: 'DB_ERROR', message: 'shelter query failed', fatal: true }))

    expect(state.pipeline.fatal.code).toBe('DB_ERROR')
    expect(state.pipeline.haltedAt).toBeGreaterThan(0)
    // The socket is untouched: a halted pipeline is not a dropped connection.
    expect(state.connection.status).toBe('connecting')
  })

  it('keeps applying later frames and counts them', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('error', { code: 'DB_ERROR', message: 'dead', fatal: true }))

    send(envelope('device_update', device({ phone: '+212600000001' })))
    send(envelope('zone_summary', { red_total: 3 }))

    expect(Object.keys(state.devices)).toHaveLength(1)
    expect(state.summary.red_total).toBe(3)
    expect(state.pipeline.framesAfterFatal).toBe(2)
  })

  it('only the FIRST fatal error is held', () => {
    const { state, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('error', { code: 'DB_ERROR', message: 'first', fatal: true }))
    send(envelope('error', { code: 'AGENT_ERROR', message: 'second', fatal: true }))
    expect(state.pipeline.fatal.message).toBe('first')
    expect(state.errors).toHaveLength(2)
  })

  it('reset clears the incident and the halt', () => {
    const { state, actions, send } = harness()
    send(envelope('event_start', EVENT_START))
    send(envelope('device_update', device()))
    send(envelope('error', { code: 'DB_ERROR', fatal: true }))

    actions.reset()

    expect(state.pipeline.fatal).toBeNull()
    expect(state.event).toBeNull()
    expect(state.activeEventId).toBeNull()
    expect(Object.keys(state.devices)).toHaveLength(0)
    expect(state.dropped.foreign).toBe(0)
  })
})
