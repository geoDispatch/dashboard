// Building the SensorInput the incident launcher POSTs.
//
// Pure and separate from the dialog so the exact bytes that go on the wire can
// be asserted in a test, rather than inferred from a screenshot of a form.
//
// depth_km is the field this module exists for. It is required by SensorInput
// on every disaster type, but it only MEANS anything for an earthquake:
// hypocentre depth is a seismological measurement. A flood and a heatwave have
// no depth, so sending 10.5 for them — which the old default did, silently —
// wrote a plausible seismic reading into a flood record. Zero is the honest
// value there: not "shallow", but "not a quantity this event has".

export const EARTHQUAKE_DEPTH_KM = 10.5

export function depthFor(disasterType) {
  return disasterType === 'earthquake' ? EARTHQUAKE_DEPTH_KM : 0
}

/**
 * One event id per launch attempt.
 *
 * Stamped once, from the clock at the moment the attempt begins, and reused
 * for the payload, the note and anything the operator reads afterwards. It is
 * NOT derived at render time: an id that changes between the summary and the
 * POST would label the incident differently from what the operator was shown.
 */
export function makeEventId(prefix, now = Date.now()) {
  const safe = (prefix || 'EVENT').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return `${safe}-${now.toString(36).toUpperCase()}`
}

/**
 * Complete SensorInput for a scenario. Every field is set explicitly so no
 * default anywhere downstream is ever reached.
 *
 * @param scenario { idPrefix, disaster_type, severity, epicenter{latitude,longitude},
 *                   radius_km, aftershock_risk, tsunami_risk }
 */
export function buildLaunchPayload(scenario, { now = Date.now(), eventId } = {}) {
  const type = scenario.disaster_type
  return {
    event_id:        eventId || makeEventId(scenario.idPrefix, now),
    disaster_type:   type,
    timestamp:       now,
    severity:        scenario.severity,
    epicenter: {
      latitude:      scenario.epicenter.latitude,
      longitude:     scenario.epicenter.longitude,
    },
    radius_km:       scenario.radius_km,
    depth_km:        depthFor(type),
    aftershock_risk: scenario.aftershock_risk,
    tsunami_risk:    !!scenario.tsunami_risk,
  }
}
