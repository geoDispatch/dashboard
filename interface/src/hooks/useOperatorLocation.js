import { createSignal } from 'solid-js'
import { resolveLocation, browserLocation, nearestRegion, MOROCCO_REGIONS } from '../lib/geo'

// "Set location" for the region selector.
//
// There is no region query on the supervisor (agent.md §6) — the selector is a
// client-side view control. It resolves where the operator actually is, names
// the Moroccan region that contains them, and hands the caller a point to fly
// the map to.
//
// The position comes from the map's own geolocation (Leaflet map.locate(), or
// the browser Geolocation API directly). That already resolves from GPS, Wi-Fi
// or IP depending on the device, so there is no third-party lookup service and
// no API key involved. If the operator declines it, they pick a region by hand.

const STORAGE_KEY = 'geodispatch.region'

export function useOperatorLocation({ onLocated } = {}) {
  const [location, setLocation] = createSignal(restore())
  const [status, setStatus]     = createSignal('idle')   // idle | locating | ok | denied | failed
  const [error, setError]       = createSignal(null)

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function persist(loc) {
    try {
      if (loc) localStorage.setItem(STORAGE_KEY, JSON.stringify(loc))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // private mode — the selector still works for this session
    }
  }

  function apply(loc) {
    setLocation(loc)
    persist(loc)
    onLocated?.(loc)
    return loc
  }

  /**
   * Resolve where the operator is.
   * Pass the map handle's `locate` so Leaflet does it; falls back to the
   * browser Geolocation API when no map handle is available yet.
   */
  async function locate({ locate: mapLocate } = {}) {
    setStatus('locating')
    setError(null)
    try {
      const fix = await resolveLocation({ locate: mapLocate })
      if (!fix) {
        setStatus('denied')
        setError('Location unavailable. Select a region instead.')
        return null
      }
      setStatus('ok')
      return apply(fix)
    } catch (err) {
      setStatus('failed')
      setError(String(err?.message ?? err))
      return null
    }
  }

  /** Pick a region by hand from the list of twelve. */
  function selectRegion(name) {
    const region = MOROCCO_REGIONS.find(r => r.name === name)
    if (!region) return null
    setStatus('ok')
    return apply({ ...region, source: 'manual' })
  }

  function clear() {
    setStatus('idle')
    apply(null)
  }

  return {
    location, status, error,
    locate, selectRegion, clear,
    regions: MOROCCO_REGIONS,
    browserLocation,
  }
}
