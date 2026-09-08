import { createSignal } from 'solid-js'
import { resolveLocation, ipLocation, browserLocation, nearestRegion, MOROCCO_REGIONS } from '../lib/geo'

// "Set location" for the region selector.
//
// There is no region query on the supervisor (agent.md §6) — the selector is a
// client-side view control. It resolves where the operator actually is, names
// the Moroccan region that contains them, and hands the caller a point to fly
// the map to. Browser geolocation is tried first because it is precise and
// consented; IP lookup is the fallback and is labelled as such, since an IP fix
// can be tens of kilometres out.

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

  /** Resolve where the operator is: GPS if granted, IP otherwise. */
  async function locate({ preferGps = true } = {}) {
    setStatus('locating')
    setError(null)
    try {
      const fix = await resolveLocation({ preferGps })
      if (!fix) {
        setStatus('failed')
        setError('Could not determine location from GPS or IP.')
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

  /** IP only — no permission prompt, coarser fix. */
  async function locateByIp() {
    setStatus('locating')
    setError(null)
    const fix = await ipLocation()
    if (!fix) {
      setStatus('failed')
      setError('IP lookup failed.')
      return null
    }
    const region = nearestRegion(fix.latitude, fix.longitude)
    setStatus('ok')
    return apply({
      ...fix,
      name: region?.name ?? fix.city ?? 'Unknown region',
      regionDistanceKm: region?.distanceKm ?? null,
    })
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
    locate, locateByIp, selectRegion, clear,
    regions: MOROCCO_REGIONS,
    browserLocation,
  }
}
