// The browser simulation: every frame it makes must be a frame a supervisor
// could have sent, and it must say what it is.

import { describe, expect, it } from 'vitest'
import { batch, createRoot } from 'solid-js'

import {
  SIM_NARRATIVE_PREFIX,
  SIM_PHONE_PREFIX,
  buildSimulation,
  isSimulatedPhone,
  simulationSize,
} from './simulation'
import { validateFrame } from './validate'
import { createConsoleStore } from './store'
import { createSelectors } from './selectors'
import { routeMessage } from './router'
import { haversine } from './geo'

const NEW_YORK = {
  event_id: 'SIM-TEST-0001',
  disaster_type: 'earthquake',
  timestamp: 1_789_000_000_000,
  severity: 6.4,
  epicenter: { latitude: 40.7128, longitude: -74.006 },
  radius_km: 25,
  depth_km: 12,
  aftershock_risk: 'MEDIUM',
  tsunami_risk: false,
}

const T0 = 1_789_000_000_000

function play(sim) {
  let result
  createRoot((dispose) => {
    const { state, actions } = createConsoleStore()
    const selectors = createSelectors(state)
    actions.setStatus('simulation')
    routeMessage(actions, { v: 2, type: 'snapshot_begin', event_id: '', seq: 0, timestamp: T0, replay: false, payload: { head_seq: 0, active: false, lifecycle: 'idle' } })
    routeMessage(actions, { v: 2, type: 'snapshot_end', event_id: '', seq: 0, timestamp: T0, replay: false, payload: { head_seq: 0, replayed: 0 } })
    // In one batch, as the socket's flush applies a burst.
    let statuses
    batch(() => { statuses = sim.frames.map(({ frame }) => routeMessage(actions, frame).status) })
    result = {
      statuses,
      devices: Object.values(state.devices),
      lifecycle: state.lifecycle.status,
      shelters: selectors.shelters(),
      counts: selectors.counts(),
      incidentState: selectors.incidentState(),
      narratives: state.narratives,
      invalid: state.counters.invalid,
    }
    dispose()
  })
  return result
}

describe('buildSimulation', () => {
  it('makes only valid contract v2 frames, in seq order, from event_start to event_complete', () => {
    const sim = buildSimulation(NEW_YORK, { now: T0 })
    const frames = sim.frames.map((f) => f.frame)
    for (const frame of frames) {
      const checked = validateFrame(frame)
      expect(checked.ok, checked.reason).toBe(true)
    }
    expect(frames[0].type).toBe('event_start')
    expect(frames.at(-1).type).toBe('event_complete')
    frames.forEach((f, i) => expect(f.seq).toBe(i + 1))
    // Offsets never go backwards, so the timers replay the frames in order.
    for (let i = 1; i < sim.frames.length; i++) {
      expect(sim.frames[i].at).toBeGreaterThanOrEqual(sim.frames[i - 1].at)
    }
  })

  it('plays through the store to a completed incident with every device decided', () => {
    const sim = buildSimulation(NEW_YORK, { now: T0 })
    const out = play(sim)
    expect(out.invalid).toBe(0)
    expect(out.statuses.every((s) => s === 'accepted')).toBe(true)
    expect(out.lifecycle).toBe('completed')
    expect(out.incidentState).toBe('completed')
    expect(out.devices).toHaveLength(sim.devices.length)
    expect(out.devices.every((d) => d.stage === 'decided')).toBe(true)
    expect(out.shelters).toHaveLength(3)
  })

  it('reaches people in all three zones, inside the radius', () => {
    const sim = buildSimulation(NEW_YORK, { now: T0 })
    expect(sim.devices.length).toBeGreaterThan(0.8 * simulationSize(NEW_YORK.radius_km))
    const zones = { red: 0, orange: 0, green: 0 }
    for (const d of sim.devices) {
      zones[d.zone] += 1
      expect(haversine(d, NEW_YORK.epicenter)).toBeLessThanOrEqual(NEW_YORK.radius_km)
    }
    expect(zones.red).toBeGreaterThan(10)
    expect(zones.orange).toBeGreaterThan(10)
    expect(zones.green).toBeGreaterThan(10)
  })

  it('applies the mock agent rules: rescue in red and orange when unreachable, never SMS "sent"', () => {
    const { frames } = buildSimulation(NEW_YORK, { now: T0 })
    const decided = frames.map((f) => f.frame).filter((f) => f.type === 'device_update' && f.payload.stage === 'decided')
    for (const { payload: p } of decided) {
      expect(p.sms_sent).toBe(false)
      if (p.zone === 'green') expect(p.rescue_flag).toBe(false)
      if (p.zone !== 'green' && !p.reachable) expect(p.action).toBe('rescue_flag')
      if (p.rescue_flag) expect(p.rescue_priority).toBeGreaterThanOrEqual(1)
      else expect(p.rescue_priority).toBe(0)
    }
  })

  it('labels itself: +999 phones, simulated shelters, simulation narratives', () => {
    const sim = buildSimulation(NEW_YORK, { now: T0 })
    expect(sim.devices.every((d) => d.phone.startsWith(SIM_PHONE_PREFIX))).toBe(true)
    expect(sim.devices.every((d) => isSimulatedPhone(d.phone))).toBe(true)
    expect(isSimulatedPhone('+212600000001')).toBe(false)
    expect(sim.shelters.every((s) => s.name.startsWith('Simulated shelter'))).toBe(true)
    const out = play(sim)
    for (const n of Object.values(out.narratives)) expect(n.narrative.startsWith(SIM_NARRATIVE_PREFIX)).toBe(true)
  })

  it('is deterministic: the same launch plays the same incident', () => {
    const a = buildSimulation(NEW_YORK, { now: T0 })
    const b = buildSimulation(NEW_YORK, { now: T0 })
    expect(a.frames).toEqual(b.frames)
    const c = buildSimulation({ ...NEW_YORK, event_id: 'SIM-TEST-0002' }, { now: T0 })
    expect(c.devices).not.toEqual(a.devices)
  })

  it('keeps every device and shelter on land when told where the water is', () => {
    // Everything east of the epicentre's meridian is "sea" for this test.
    const isLand = (lat, lng) => lng <= NEW_YORK.epicenter.longitude
    const sim = buildSimulation(NEW_YORK, { now: T0, isLand })
    expect(sim.devices.length).toBeGreaterThan(50)
    for (const d of sim.devices) expect(d.longitude).toBeLessThanOrEqual(NEW_YORK.epicenter.longitude)
    for (const s of sim.shelters) expect(s.location.longitude).toBeLessThanOrEqual(NEW_YORK.epicenter.longitude)
  })

  it('an epicentre in open sea finds nobody and completes with no_devices', () => {
    const sim = buildSimulation(NEW_YORK, { now: T0, isLand: () => false })
    const types = sim.frames.map((f) => f.frame.type)
    expect(types).toEqual(['event_start', 'event_context', 'event_complete'])
    const out = play(sim)
    expect(out.lifecycle).toBe('no_devices')
    expect(out.devices).toHaveLength(0)
  })

  it('a water test that throws is treated as land rather than breaking the launch', () => {
    const sim = buildSimulation(NEW_YORK, { now: T0, isLand: () => { throw new Error('no GL context') } })
    expect(sim.devices.length).toBeGreaterThan(0)
  })

  it('simulates earthquakes only: flood and heatwave are refused as coming soon', () => {
    // Rings around an epicentre are not how water or heat spreads, and a
    // flood in the middle of a desert would be a lie on the map.
    for (const type of ['flood', 'heatwave']) {
      expect(() => buildSimulation({ ...NEW_YORK, disaster_type: type }, { now: T0 })).toThrow(/coming soon/)
    }
    expect(() => buildSimulation({ ...NEW_YORK, disaster_type: 'tornado' }, { now: T0 })).toThrow(/coming soon/)
    expect(() => buildSimulation(NEW_YORK, { now: T0 })).not.toThrow()
  })
})
