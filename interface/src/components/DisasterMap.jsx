import { onMount, onCleanup, createEffect } from 'solid-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ZONE_COLORS } from '../constants/zones'
import { maskPhone } from '../lib/format'

// The impact map. Leaflet, canvas-rendered — a 50 km radius over a populated
// region is thousands of dots and SVG markers stop being viable well before that.
//
// Zone is never encoded by colour alone: unreachable devices are drawn hollow
// and rescue-flagged devices carry a ring, so the map still reads for a
// red/green colour-blind operator.

const DEFAULT_CENTER = [31.0625, -8.4144]   // Al Haouz
const DEFAULT_ZOOM   = 9

export default function DisasterMap(props) {
  let container
  let map
  let renderer
  let impactRings = []
  let epicenterMarker = null
  let operatorMarker = null
  const markers = new Map()   // phone → L.CircleMarker

  onMount(() => {
    map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      preferCanvas: true,
      attributionControl: false,
    })

    renderer = L.canvas({ padding: 0.5 })

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '© OpenStreetMap · © CARTO',
      },
    ).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map)
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map)

    // Clicking empty map clears the selection — the details panel returns to
    // its "no device chosen" state.
    map.on('click', () => props.onSelect?.(null))

    // Hand an imperative handle back so the shell can fly to a region.
    props.onReady?.({
      flyTo: (lat, lng, zoom = 11) => map.flyTo([lat, lng], zoom, { duration: 1.2 }),
      fitEvent: () => fitToEvent(),
      focusDevice: (phone) => {
        const m = markers.get(phone)
        if (m) map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 12), { duration: 0.8 })
      },
      invalidate: () => map.invalidateSize(),
    })

    // The map lives inside a flex panel that resizes with the layout.
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(container)
    onCleanup(() => ro.disconnect())
  })

  onCleanup(() => {
    markers.clear()
    map?.remove()
  })

  function fitToEvent() {
    const ev = props.event
    if (!map || !ev?.epicenter) return
    const c = L.latLng(ev.epicenter.latitude, ev.epicenter.longitude)
    map.fitBounds(c.toBounds(ev.radius_km * 2000), { padding: [24, 24] })
  }

  // ── epicentre + zone rings ────────────────────────────────
  createEffect(() => {
    const ev = props.event
    if (!map) return

    impactRings.forEach(r => r.remove())
    impactRings = []
    epicenterMarker?.remove()
    epicenterMarker = null

    if (!ev?.epicenter) return

    const center = [ev.epicenter.latitude, ev.epicenter.longitude]
    const radius = ev.radius_km ?? 0

    // Rings drawn outermost first so the red band sits on top.
    const bands = [
      { frac: 1.00, color: ZONE_COLORS.green },
      { frac: 0.66, color: ZONE_COLORS.orange },
      { frac: 0.33, color: ZONE_COLORS.red },
    ]

    for (const band of bands) {
      impactRings.push(
        L.circle(center, {
          radius: radius * 1000 * band.frac,
          color: band.color,
          weight: 1,
          opacity: 0.38,
          dashArray: '4 6',
          fillColor: band.color,
          fillOpacity: 0.035,
          interactive: false,
        }).addTo(map),
      )
    }

    epicenterMarker = L.marker(center, {
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: '',
        html: '<div class="epicentre"><span class="epicentre-pulse"></span></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(map)

    fitToEvent()
  })

  // ── device dots ───────────────────────────────────────────
  createEffect(() => {
    const devices = props.devices || {}
    const selected = props.selectedPhone
    if (!map) return

    for (const device of Object.values(devices)) {
      const { phone, latitude, longitude } = device
      if (typeof latitude !== 'number' || typeof longitude !== 'number') continue

      const style = styleFor(device, phone === selected)
      const existing = markers.get(phone)

      if (existing) {
        existing.setLatLng([latitude, longitude])
        existing.setStyle(style)
        existing.setRadius(style.radius)
        existing.setTooltipContent(tooltipFor(device))
      } else {
        const marker = L.circleMarker([latitude, longitude], { ...style, renderer })
        marker.bindTooltip(tooltipFor(device), {
          direction: 'top',
          offset: [0, -6],
          className: 'device-tip',
        })
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          props.onSelect?.(phone)
        })
        marker.addTo(map)
        markers.set(phone, marker)
      }
    }

    // Devices never disappear mid-event, but a new event clears the store.
    if (markers.size > Object.keys(devices).length) {
      for (const [phone, marker] of markers) {
        if (!devices[phone]) {
          marker.remove()
          markers.delete(phone)
        }
      }
    }
  })

  // ── operator position (Set location) ──────────────────────
  createEffect(() => {
    const loc = props.operator
    if (!map) return
    operatorMarker?.remove()
    operatorMarker = null
    if (!loc) return

    operatorMarker = L.marker([loc.latitude, loc.longitude], {
      zIndexOffset: 900,
      icon: L.divIcon({
        className: '',
        html: '<div class="operator-pin"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    })
      .bindTooltip(
        `You are here · ${loc.source === 'gps' ? 'GPS' : loc.source === 'ip' ? 'IP estimate' : 'manual'}`,
        { direction: 'top', className: 'device-tip' },
      )
      .addTo(map)
  })

  return <div ref={container} class="map-canvas" />
}

function styleFor(device, isSelected) {
  const color = ZONE_COLORS[device.zone] ?? '#8A93A0'
  const rescue = !!device.rescue_flag
  const reachable = !!device.reachable

  return {
    // Rescue dots are larger and ringed; selection adds a further step up.
    radius: isSelected ? 9 : rescue ? 6.5 : 4.5,
    color: isSelected ? '#FFFFFF' : color,
    weight: isSelected ? 2.5 : rescue ? 2 : reachable ? 0.5 : 1.5,
    opacity: 1,
    fillColor: color,
    // Unreachable devices are hollow — the second channel for reachability.
    fillOpacity: reachable ? 0.92 : 0.12,
  }
}

function tooltipFor(d) {
  const zone = d.zone ? d.zone.toUpperCase() : '—'
  const reach = d.reachable ? 'reachable' : 'unreachable'
  const rescue = d.rescue_flag ? ' · rescue' : ''
  return `${maskPhone(d.phone)} · ${zone} · ${reach}${rescue}`
}
