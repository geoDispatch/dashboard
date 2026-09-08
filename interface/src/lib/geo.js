// Geography helpers: haversine (mirrors the Go supervisor's zone maths),
// locality lookup for the Al Haouz demo scenario, and "where am I" resolution
// for the region selector.

const R_EARTH_KM = 6371

export function haversine(a, b) {
  if (!a || !b) return null
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h))
}

// Morocco's twelve regions — the selector has no backend query yet (agent.md §6),
// so the list is local. Centres are approximate administrative centroids.
export const MOROCCO_REGIONS = [
  { name: 'Tanger-Tétouan-Al Hoceïma',  latitude: 35.2517, longitude: -5.3720 },
  { name: 'Oriental',                   latitude: 34.2610, longitude: -2.4000 },
  { name: 'Fès-Meknès',                 latitude: 33.8935, longitude: -4.8000 },
  { name: 'Rabat-Salé-Kénitra',         latitude: 34.0132, longitude: -6.5000 },
  { name: 'Béni Mellal-Khénifra',       latitude: 32.5000, longitude: -6.0000 },
  { name: 'Casablanca-Settat',          latitude: 33.3600, longitude: -7.4000 },
  { name: 'Marrakech-Safi',             latitude: 31.6295, longitude: -8.0080 },
  { name: 'Drâa-Tafilalet',             latitude: 31.2000, longitude: -5.4000 },
  { name: 'Souss-Massa',                latitude: 30.4200, longitude: -9.0000 },
  { name: 'Guelmim-Oued Noun',          latitude: 28.9870, longitude: -10.0570 },
  { name: 'Laâyoune-Sakia El Hamra',    latitude: 27.1500, longitude: -13.2000 },
  { name: 'Dakhla-Oued Ed-Dahab',       latitude: 23.6850, longitude: -15.9300 },
]

// Al Haouz demo localities. Counts match the scenario table in agent.md §11
// so the demo never contradicts itself (total 4,812).
export const AL_HAOUZ_LOCALITIES = [
  { name: 'Amizmiz',         zone: 'orange', people: 1129, latitude: 31.2167, longitude: -8.2333 },
  { name: 'Asni',            zone: 'orange', people:  842, latitude: 31.2544, longitude: -7.9819 },
  { name: 'Tahannaout',      zone: 'green',  people:  721, latitude: 31.3572, longitude: -7.9500 },
  { name: "Talat N'Yaaqoub", zone: 'red',    people:  634, latitude: 30.9833, longitude: -8.3833 },
  { name: 'Marrakech Sud',   zone: 'green',  people:  622, latitude: 31.5500, longitude: -8.0500 },
  { name: 'Ouirgane',        zone: 'red',    people:  495, latitude: 31.1667, longitude: -8.0833 },
  { name: 'Moulay Brahim',   zone: 'orange', people:  369, latitude: 31.2833, longitude: -8.0333 },
]

// device_update carries lat/lng but no place name — reverse geocoding is a
// backend gap. Nearest-centroid over the demo localities stands in for it.
export function nearestLocality(lat, lng, localities = AL_HAOUZ_LOCALITIES) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  let best = null
  let bestKm = Infinity
  for (const loc of localities) {
    const d = haversine({ latitude: lat, longitude: lng }, loc)
    if (d !== null && d < bestKm) {
      bestKm = d
      best = loc
    }
  }
  return best ? { ...best, distanceKm: bestKm } : null
}

export function nearestRegion(lat, lng) {
  return nearestLocality(lat, lng, MOROCCO_REGIONS)
}

// ── "Set location" ────────────────────────────────────────────
// Best-effort and keyless: the caller must handle null and fall back to
// picking a region by hand.

export function browserLocation({ timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        source:    'browser',
      }),
      () => resolve(null),
      { timeout, maximumAge: 60_000, enableHighAccuracy: false },
    )
  })
}

// Resolve the operator's position, then name the region it falls in.
//
// The browser's Geolocation API is the only source — it already resolves from
// GPS, Wi-Fi or IP, whichever the device has, so there is no third-party
// geolocation service to call and no API key to hold. Leaflet exposes the same
// thing as map.locate(); DisasterMap's onReady handle wraps it.
export async function resolveLocation({ locate } = {}) {
  const fix = locate ? await locate() : await browserLocation()
  if (!fix) return null
  const region = nearestRegion(fix.latitude, fix.longitude)
  return {
    ...fix,
    name: region?.name ?? fix.city ?? 'Unknown region',
    regionDistanceKm: region?.distanceKm ?? null,
  }
}
