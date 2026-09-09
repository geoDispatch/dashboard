import { onMount, onCleanup, createEffect } from 'solid-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ZONE_COLORS } from '../constants/zones'
import { maskPhone } from '../lib/format'
import { haversine } from '../lib/geo'

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

  // Leaflet fires the marker's click and then the map's click in the same tick,
  // and stopPropagation on a canvas layer does not reliably suppress the second.
  // Without this the map handler would immediately overwrite a device selection
  // with the zone the device happens to sit in, so a dot could never be picked.
  let deviceClickAt = 0

  // Which band's edge the cursor is on, so it can be highlighted.
  let hoveredZone = null

  // The rings effect re-runs whenever the selection or the layer toggles
  // change. Refitting the view on each of those would yank the map out from
  // under the operator every time they picked a zone — and did, because the
  // second fit measured a stale container and resolved to maxZoom. The view is
  // framed once per event instead.
  let fittedEventKey = null

  // How close to a ring's circumference a click counts as hitting it.
  const EDGE_TOLERANCE_PX = 12

  // Metres to screen pixels at the current zoom, measured by projecting a point
  // that many metres east of the centre.
  function metresToPixels(centerLatLng, metres) {
    if (!map || !metres) return 0
    const latRad = (centerLatLng.lat * Math.PI) / 180
    const lngOffset = metres / (111320 * Math.max(0.01, Math.cos(latRad)))
    const a = map.latLngToLayerPoint(centerLatLng)
    const b = map.latLngToLayerPoint(L.latLng(centerLatLng.lat, centerLatLng.lng + lngOffset))
    return a.distanceTo(b)
  }

  // The band whose circumference is under this point, or null.
  function edgeHitZone(containerPoint) {
    const ev = props.event
    if (!map || !ev?.epicenter || !impactRings.length) return null
    if (!layerOn('zones')) return null

    const center = L.latLng(ev.epicenter.latitude, ev.epicenter.longitude)
    const centerPt = map.latLngToContainerPoint(center)
    const distPx = centerPt.distanceTo(containerPoint)

    let best = null
    let bestDelta = Infinity

    for (const ring of impactRings) {
      const radiusPx = metresToPixels(center, ring.metres)
      const delta = Math.abs(distPx - radiusPx)
      if (delta <= EDGE_TOLERANCE_PX && delta < bestDelta) {
        bestDelta = delta
        best = ring.zone
      }
    }
    return best
  }

  // One place decides how a ring looks in each state.
  function ringStyle(zone, color, selectedZone, hovered) {
    const isSelected = selectedZone === zone
    const isHovered = hovered === zone

    return {
      color,
      // The edge is the click target, so it stays visible enough to aim at.
      weight: isSelected ? 3 : isHovered ? 3 : 1.5,
      opacity: isSelected ? 0.95 : isHovered ? 0.85 : 0.5,
      dashArray: isSelected || isHovered ? null : '5 7',
      fillColor: color,
      fillOpacity: isSelected ? 0.08 : 0.03,
    }
  }

  // Applied imperatively so hovering does not rebuild the rings.
  function restyleRings() {
    for (const ring of impactRings) {
      ring.layer.setStyle(ringStyle(ring.zone, ring.color, props.selectedZone, hoveredZone))
    }
  }

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
    // Bottom-left is the details column's corner — the scale bar rendered
    // half-hidden behind the cards, reading "2C" instead of "20 km".
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 120 }).addTo(map)

    // Zone selection is an EDGE hit, not an area hit.
    //
    // Treating the whole band as the target made the zones layer one enormous
    // click surface sitting under every dot: with all three layers on, a click
    // that missed a dot by a pixel selected the band instead, so devices were
    // effectively unclickable. The rings are non-interactive now, and a click
    // only selects a zone when it lands within a few pixels of that band's
    // circumference. Everything else is the map.
    map.on('click', (e) => {
      if (performance.now() - deviceClickAt < 250) return

      const zone = edgeHitZone(e.containerPoint)
      if (zone) return props.onSelectZone?.(zone)

      props.onSelect?.(null)
    })

    // Hover feedback, so the edge reads as a target rather than decoration.
    map.on('mousemove', (e) => {
      const zone = edgeHitZone(e.containerPoint)
      const container = map.getContainer()

      if (zone !== hoveredZone) {
        hoveredZone = zone
        container.style.cursor = zone ? 'pointer' : ''
        restyleRings()
      }
    })

    map.on('mouseout', () => {
      if (hoveredZone) {
        hoveredZone = null
        map.getContainer().style.cursor = ''
        restyleRings()
      }
    })

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
    // Leaflet sizes the fit from its cached container size. If that is stale or
    // the container has not been laid out yet, fitBounds silently resolves to
    // maxZoom — the map ends up at street level over an empty field instead of
    // showing the whole impact area. Refresh the size first, and bail if the
    // container genuinely has no width yet.
    map.invalidateSize({ animate: false })
    if (map.getSize().x < 50) return

    const c = L.latLng(ev.epicenter.latitude, ev.epicenter.longitude)
    map.fitBounds(c.toBounds(ev.radius_km * 2000), { padding: [24, 24], animate: false })
  }

  // ── epicentre + zone rings ────────────────────────────────
  // The "Zones" layer owns both: the bands and the epicentre marker are one
  // reading of the event, so they go together.
  createEffect(() => {
    const ev = props.event
    const show = layerOn('zones')
    if (!map) return

    impactRings.forEach(r => r.layer.remove())
    impactRings = []
    epicenterMarker?.remove()
    epicenterMarker = null
    hoveredZone = null

    if (!show) return
    if (!ev?.epicenter) return

    const center = [ev.epicenter.latitude, ev.epicenter.longitude]
    const radius = ev.radius_km ?? 0

    // Outermost first so the red band draws on top of the green disc.
    const bands = [
      { zone: 'green',  frac: 1.00, color: ZONE_COLORS.green },
      { zone: 'orange', frac: 0.66, color: ZONE_COLORS.orange },
      { zone: 'red',    frac: 0.33, color: ZONE_COLORS.red },
    ]

    for (const band of bands) {
      const metres = radius * 1000 * band.frac

      const layer = L.circle(center, {
        renderer,
        radius: metres,
        // Not interactive: hit-testing happens at map level against the
        // circumference only, so the band's interior never steals a click
        // meant for a device dot underneath it.
        interactive: false,
        ...ringStyle(band.zone, band.color, props.selectedZone, hoveredZone),
      }).addTo(map)

      impactRings.push({ zone: band.zone, color: band.color, metres, layer })
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

    const eventKey = `${ev.event_id ?? ''}:${radius}`
    if (eventKey !== fittedEventKey) {
      fittedEventKey = eventKey
      fitToEvent()
    }
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
          deviceClickAt = performance.now()
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
