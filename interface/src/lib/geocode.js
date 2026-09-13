// Place search for the "Set location" control: type "new y", get New York.
//
// Names are looked up with Photon (photon.komoot.io), a free, keyless search
// over OpenStreetMap that is built for search-as-you-type. The public
// Nominatim instance forbids exactly that use, which is why it is not used
// here. What is sent is the typed text and nothing else: no position, no
// operator, no incident.
//
// Coordinates need no service at all: "31.058, -8.385" and
// 31°03'29"N 8°23'06"W are recognised here and offered as a place of their
// own, so the control still works with no network.

export const PHOTON_URL = 'https://photon.komoot.io/api/'
export const SEARCH_LIMIT = 6
export const MIN_QUERY_LENGTH = 2

// OpenStreetMap place kinds worth flying to, and how close to fly.
const PLACE_ZOOM = {
  country: 5,
  state: 7,
  region: 7,
  province: 7,
  county: 9,
  city: 11,
  municipality: 11,
  borough: 12,
  town: 12,
  district: 13,
  suburb: 13,
  quarter: 14,
  village: 13,
  hamlet: 14,
  neighbourhood: 14,
  locality: 14,
  island: 11,
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

// ── coordinates ────────────────────────────────────────────────────────────

// 31°03'29"N or 31 03 29 N, one axis.
const DMS_AXIS = /^\s*(\d{1,3})\s*[°\s]\s*(\d{1,2})\s*['′\s]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″]|'')?\s*([NSEW])\s*$/i

function dmsAxis(text) {
  const m = DMS_AXIS.exec(text)
  if (!m) return null
  const [, d, min, sec, hemi] = m
  if (Number(min) >= 60 || Number(sec) >= 60) return null
  const value = Number(d) + Number(min) / 60 + Number(sec) / 3600
  const sign = /[SW]/i.test(hemi) ? -1 : 1
  return { value: sign * value, axis: /[NS]/i.test(hemi) ? 'lat' : 'lng' }
}

/**
 * "31.058, -8.385", "31.058 -8.385" or 31°03'29"N 8°23'06"W → { latitude, longitude },
 * else null. Decimal pairs are read latitude first, the way every map writes them.
 */
export function parseCoordinates(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const decimal = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(trimmed)
  if (decimal) {
    const latitude = Number(decimal[1])
    const longitude = Number(decimal[2])
    return validPoint(latitude, longitude)
  }

  // Two DMS halves, split at the first hemisphere letter.
  const split = /^(.*?[NS])\s*[,;]?\s*(.*[EW])\s*$/i.exec(trimmed)
  if (split) {
    const a = dmsAxis(split[1])
    const b = dmsAxis(split[2])
    if (a && b && a.axis === 'lat' && b.axis === 'lng') return validPoint(a.value, b.value)
  }
  return null
}

function validPoint(latitude, longitude) {
  if (!isNum(latitude) || !isNum(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

// ── Photon ─────────────────────────────────────────────────────────────────

/** The request URL for a query. Only the text, a result limit and the language. */
export function photonUrl(query, { limit = SEARCH_LIMIT, lang = 'en' } = {}) {
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit), lang })
  return `${PHOTON_URL}?${params}`
}

/**
 * One Photon GeoJSON feature → a place, or null when it is not a place worth
 * flying to (a single house, a shop, a bus stop).
 *
 * @returns { id, name, label, latitude, longitude, kind, zoom, bounds }
 *   label   "New York, New York, United States" — name plus what disambiguates it
 *   bounds  [[south, west], [north, east]] when Photon gave an extent
 */
export function toPlace(feature) {
  const p = feature?.properties
  const coords = feature?.geometry?.coordinates
  if (!p || !Array.isArray(coords)) return null
  const [longitude, latitude] = coords
  if (!validPoint(latitude, longitude) || !p.name) return null

  // A place node says what it is (city, town, village); an administrative
  // boundary only says which level it is (state, county, city).
  const kind = p.osm_key === 'place' ? p.osm_value : p.type
  const zoom = PLACE_ZOOM[kind] ?? PLACE_ZOOM[p.type]
  if (zoom === undefined) return null

  // City, region, country. Not the county: in Morocco that is the pachalik
  // ("باشوية الرباط"), which pushed the country off a three-part label.
  const parts = [p.name]
  for (const extra of [p.city, p.state, p.country]) {
    if (extra && !parts.includes(extra)) parts.push(extra)
  }

  // Photon's extent is [west, north, east, south].
  const e = p.extent
  const bounds = Array.isArray(e) && e.length === 4 && e.every(isNum)
    ? [[e[3], e[0]], [e[1], e[2]]]
    : null

  return {
    id: `${p.osm_type || ''}${p.osm_id || `${latitude},${longitude}`}`,
    name: p.name,
    label: parts.slice(0, 3).join(', '),
    latitude,
    longitude,
    kind,
    zoom,
    bounds,
  }
}

/** A typed coordinate pair as a place of its own. */
export function coordinatePlace(point) {
  return {
    id: `coords:${point.latitude},${point.longitude}`,
    name: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,
    label: 'Coordinates',
    latitude: point.latitude,
    longitude: point.longitude,
    kind: 'coordinates',
    zoom: 13,
    bounds: null,
  }
}

/**
 * Places matching `query`. Coordinates are answered locally; anything else
 * goes to Photon. Throws only on abort; a failed request resolves to [] with
 * `error` set, so the list can say what went wrong.
 *
 * @returns { places, error }
 */
export async function searchPlaces(query, { signal, fetchImpl = globalThis.fetch, limit = SEARCH_LIMIT } = {}) {
  const text = typeof query === 'string' ? query.trim() : ''
  const point = parseCoordinates(text)
  if (point) return { places: [coordinatePlace(point)], error: null }
  if (text.length < MIN_QUERY_LENGTH) return { places: [], error: null }

  let res
  try {
    res = await fetchImpl(photonUrl(text, { limit: limit * 2 }), { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return { places: [], error: 'Place search is unreachable. Coordinates still work.' }
  }
  if (!res.ok) return { places: [], error: `Place search answered ${res.status}. Coordinates still work.` }

  let body
  try {
    body = await res.json()
  } catch {
    return { places: [], error: 'Place search sent an unreadable answer.' }
  }
  const seen = new Set()
  const places = []
  for (const feature of Array.isArray(body?.features) ? body.features : []) {
    const place = toPlace(feature)
    if (!place || seen.has(place.label)) continue
    seen.add(place.label)
    places.push(place)
    if (places.length >= limit) break
  }
  return { places, error: null }
}
