import { createSignal, onCleanup, onMount } from 'solid-js'

// Live health of the operator's own link — the Wi-Fi this console is sitting on.
//
// This is deliberately NOT the CAMARA congestion level: that describes the
// disaster area's cell network and is a backend gap. This is the browser's own
// Network Information API plus a measured round-trip to the supervisor, and the
// UI labels it as the operator link so the two are never confused.

const conn = () =>
  navigator.connection || navigator.mozConnection || navigator.webkitConnection || null

export function useNetworkStats({ pingUrl = null, pingMs = 10_000 } = {}) {
  const [online, setOnline]     = createSignal(navigator.onLine)
  const [info, setInfo]         = createSignal(read())
  const [rttMs, setRttMs]       = createSignal(null)   // measured, not estimated

  function read() {
    const c = conn()
    if (!c) {
      return {
        supported:     false,
        type:          null,
        effectiveType: null,
        downlinkMbps:  null,
        rttMs:         null,
        saveData:      false,
      }
    }
    return {
      supported:     true,
      type:          c.type ?? null,              // wifi | cellular | ethernet | …
      effectiveType: c.effectiveType ?? null,     // slow-2g | 2g | 3g | 4g
      downlinkMbps:  typeof c.downlink === 'number' ? c.downlink : null,
      rttMs:         typeof c.rtt === 'number' ? c.rtt : null,
      saveData:      !!c.saveData,
    }
  }

  onMount(() => {
    const c = conn()
    const onChange = () => setInfo(read())
    const onUp     = () => setOnline(true)
    const onDown   = () => setOnline(false)

    c?.addEventListener?.('change', onChange)
    window.addEventListener('online', onUp)
    window.addEventListener('offline', onDown)

    // Measured RTT to the supervisor beats the browser's coarse estimate.
    let pingTimer = null
    async function ping() {
      if (!pingUrl) return
      const t0 = performance.now()
      try {
        await fetch(pingUrl, { cache: 'no-store', mode: 'no-cors' })
        setRttMs(Math.round(performance.now() - t0))
      } catch {
        setRttMs(null)
      }
    }
    if (pingUrl) {
      ping()
      pingTimer = setInterval(ping, pingMs)
    }

    onCleanup(() => {
      c?.removeEventListener?.('change', onChange)
      window.removeEventListener('online', onUp)
      window.removeEventListener('offline', onDown)
      if (pingTimer) clearInterval(pingTimer)
    })
  })

  // A single word for the chip: good | fair | poor | offline.
  const quality = () => {
    if (!online()) return 'offline'
    const i = info()
    const rtt = rttMs() ?? i.rttMs
    if (i.effectiveType === 'slow-2g' || i.effectiveType === '2g') return 'poor'
    if (rtt != null && rtt > 400) return 'poor'
    if (i.downlinkMbps != null && i.downlinkMbps < 1.5) return 'poor'
    if (i.effectiveType === '3g') return 'fair'
    if (rtt != null && rtt > 150) return 'fair'
    return 'good'
  }

  const label = () => {
    const i = info()
    if (!online()) return 'Offline'
    if (!i.supported) return 'Link up'
    const kind = i.type === 'wifi' ? 'Wi-Fi'
      : i.type === 'ethernet' ? 'Ethernet'
      : i.type === 'cellular' ? 'Cellular'
      : 'Link'
    return i.downlinkMbps != null ? `${kind} · ${i.downlinkMbps.toFixed(1)} Mb/s` : kind
  }

  return { online, info, rttMs, quality, label }
}
