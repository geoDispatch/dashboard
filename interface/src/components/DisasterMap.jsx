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
//
// props:
//   event, devices, selectedPhone, operator, onSelect, onReady
//   layers   — { zones, devices, shelters }; each key genuinely adds or removes
//              its objects from the map rather than just hiding them. Omit the
//              prop entirely and zones + devices draw, shelters do not.
//   shelters — [{ name, latitude, longitude, occupied, capacity, anchor }];
//              entries without coordinates are skipped, never guessed at.

const DEFAULT_CENTER = [31.0625, -8.4144]   // Al Haouz
const DEFAULT_ZOOM   = 9
const TILE_MAX_ZOOM  = 16   // the Esri light-gray canvas stops here

// Defaults for when no `layers` prop is passed at all. Once it IS passed it is
// read literally, so a key the caller left out means "off", not "on".
const LAYER_DEFAULTS = { zones: true, devices: true, shelters: false }

export default function DisasterMap(props) {
  let container
  let map
  let renderer
  let impactRings = []
  let epicenterMarker = null
  let operatorMarker = null
  let shelterMarkers = []
  const markers = new Map()   // phone → L.CircleMarker

  const layerOn = (key) => {
    if (!props.layers) return LAYER_DEFAULTS[key]
    return !!props.layers[key]
  }

  onMount(() => {
    map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      preferCanvas: true,
      attributionControl: false,
      maxZoom: TILE_MAX_ZOOM,
    })

    renderer = L.canvas({ padding: 0.5 })

    // Esri's World Light Gray canvas — the muted grey base the design uses,
    // and genuinely keyless. (CARTO's basemaps are not: they now watermark
    // "API KEY REQUIRED" straight into the tile image and still return HTTP 200,
    // so a failed key check looks like a successful fetch.)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: TILE_MAX_ZOOM,
        attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ',
      },
    ).addTo(map)

    // Place names ride above the data so the operator can name a locality.
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: TILE_MAX_ZOOM, pane: 'shadowPane', attribution: '' },
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

      // Leaflet's own geolocation — no third-party service, no API key.
      // The browser resolves it from GPS, Wi-Fi or IP, whichever it has.
      locate: () => new Promise((resolve) => {
        map.once('locationfound', (e) => resolve({
          latitude:  e.latlng.lat,
          longitude: e.latlng.lng,
          accuracyM: e.accuracy,
          source:    'browser',
        }))
        map.once('locationerror', () => resolve(null))
        map.locate({ setView: true, maxZoom: 11, enableHighAccuracy: false, timeout: 8000 })
      }),
    })

    // The map lives inside a flex panel that resizes with the layout.
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(container)
    onCleanup(() => ro.disconnect())
  })

  onCleanup(() => {
    markers.clear()
    shelterMarkers = []
    map?.remove()
  })

  function fitToEvent() {
    const ev = props.event
    if (!map || !ev?.epicenter) return
    const c = L.latLng(ev.epicenter.latitude, ev.epicenter.longitude)
    map.fitBounds(c.toBounds(ev.radius_km * 2000), { padding: [24, 24] })
  }

  // ── epicentre + zone rings ────────────────────────────────
  // The "Zones" layer owns both: the bands and the epicentre marker are one
  // reading of the event, so they go together.
  createEffect(() => {
    const ev = props.event
    const show = layerOn('zones')
    if (!map) return

    impactRings.forEach(r => r.remove())
    impactRings = []
    epicenterMarker?.remove()
    epicenterMarker = null

    if (!show) return
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
    const show = layerOn('devices')
    if (!map) return

    // Turning the layer off really removes the dots — the map keeps panning
    // at full speed instead of dragging thousands of hidden markers around.
    if (!show) {
      for (const [, marker] of markers) marker.remove()
      markers.clear()
      return
    }

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

  // ── shelters ──────────────────────────────────────────────
  // Shelters come from the bundled Al Haouz scenario — the supervisor does not
  // publish them. Only the ones whose name resolves to a known locality carry
  // coordinates; the rest are listed in the panel and left off the map rather
  // than dropped at an invented point.
  createEffect(() => {
    const show = layerOn('shelters')
    const list = props.shelters || []
    if (!map) return

    shelterMarkers.forEach(m => m.remove())
    shelterMarkers = []

    if (!show) return

    for (const shelter of list) {
      if (typeof shelter.latitude !== 'number' || typeof shelter.longitude !== 'number') continue

      const marker = L.marker([shelter.latitude, shelter.longitude], {
        zIndexOffset: 800,
        icon: L.divIcon({
          className: '',
          html: '<div class="shelter-pin"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      })
        .bindTooltip(shelterTip(shelter), { direction: 'top', className: 'device-tip' })
        .addTo(map)

      shelterMarkers.push(marker)
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

// Occupancy is only stated when both numbers are actually present.
function shelterTip(shelter) {
  const known =
    typeof shelter.occupied === 'number' && typeof shelter.capacity === 'number'
  const occupancy = known ? ` · ${shelter.occupied} of ${shelter.capacity}` : ' · occupancy —'
  return `Shelter · ${shelter.name}${occupancy}`
}

function tooltipFor(d) {
  const zone = d.zone ? d.zone.toUpperCase() : '—'
  const reach = d.reachable ? 'reachable' : 'unreachable'
  const rescue = d.rescue_flag ? ' · rescue' : ''
  return `${maskPhone(d.phone)} · ${zone} · ${reach}${rescue}`
}
