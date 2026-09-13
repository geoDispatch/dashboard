// The last simulation this browser ran, so it can be run again — Stop, then
// Run, as often as a demo needs — without opening the launcher each time.
//
// What is kept is the SensorInput the operator launched and nothing else: an
// epicentre they chose, a magnitude, a radius. No device, no phone, nothing
// from any supervisor. Running it again replays the identical incident, since
// a simulation is a pure function of its input.
//
// A stored value is validated against the simulation's own capabilities
// before it is used, so an old or hand-edited entry (a flood saved before
// floods were refused, a field out of range) is dropped rather than run.

import { SIMULATION_CAPABILITIES, validateSensorInput } from './launch'

export const LAST_SIMULATION_KEY = 'geodispatch.last-simulation.v1'

const defaultStorage = () => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const usable = (sensor) => validateSensorInput(sensor, SIMULATION_CAPABILITIES).ok

/** The saved simulation's SensorInput, or null when there is none worth running. */
export function readLastSimulation(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(LAST_SIMULATION_KEY)
    if (!raw) return null
    const sensor = JSON.parse(raw)
    return usable(sensor) ? sensor : null
  } catch {
    return null
  }
}

/** Remember a simulation that was run. Returns false when it cannot be kept. */
export function writeLastSimulation(sensor, storage = defaultStorage()) {
  if (!usable(sensor)) return false
  try {
    storage?.setItem(LAST_SIMULATION_KEY, JSON.stringify(sensor))
    return !!storage
  } catch {
    return false
  }
}
