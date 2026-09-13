// When the map should re-fit to the incident — as a pure function, so the
// rule can be tested without Leaflet.
//
// Keyed on what the fit depends on, not on the event id alone: an event_start
// that reuses an id with a moved epicentre or a different radius describes a
// different circle, and a map that kept the old framing would crop it.

/** `${event_id}|${lat}|${lng}|${radius_km}`, or null when there is no event. */
export function eventFitKey(event) {
  if (!event || !event.epicenter) return null
  const { latitude, longitude } = event.epicenter
  return `${event.event_id}|${latitude}|${longitude}|${event.radius_km}`
}
