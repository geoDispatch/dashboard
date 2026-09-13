import { describe, expect, it } from 'vitest'

import { LAST_SIMULATION_KEY, readLastSimulation, writeLastSimulation } from './lastSimulation'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

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

describe('last simulation', () => {
  it('there is nothing to run again before a simulation has been run', () => {
    expect(readLastSimulation(memoryStorage())).toBeNull()
  })

  it('keeps exactly the SensorInput that was run, and gives it back', () => {
    const storage = memoryStorage()
    expect(writeLastSimulation(NEW_YORK, storage)).toBe(true)
    expect(JSON.parse(storage.getItem(LAST_SIMULATION_KEY))).toEqual(NEW_YORK)
    expect(readLastSimulation(storage)).toEqual(NEW_YORK)
  })

  it('never keeps or returns what the simulation would refuse', () => {
    const storage = memoryStorage()
    // A flood is coming soon, not simulated: not saved.
    expect(writeLastSimulation({ ...NEW_YORK, disaster_type: 'flood' }, storage)).toBe(false)
    expect(storage.getItem(LAST_SIMULATION_KEY)).toBeNull()

    // A flood saved by an older build, a broken value, a missing field: dropped.
    for (const raw of [
      JSON.stringify({ ...NEW_YORK, disaster_type: 'flood' }),
      JSON.stringify({ ...NEW_YORK, radius_km: 0 }),
      JSON.stringify({ ...NEW_YORK, epicenter: undefined }),
      '{not json',
    ]) {
      expect(readLastSimulation(memoryStorage({ [LAST_SIMULATION_KEY]: raw }))).toBeNull()
    }
  })

  it('works without storage: nothing is kept, nothing breaks', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(writeLastSimulation(NEW_YORK, blocked)).toBe(false)
    expect(readLastSimulation(blocked)).toBeNull()
  })
})
