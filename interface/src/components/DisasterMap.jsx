import { onMount, createEffect } from 'solid-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ZONE_COLORS } from '../constants/zones'

export default function DisasterMap({ event, devices }) {
  let mapContainer
  let map
  let impactCircle = null
  let epicenterMarker = null
  const markerMap = new Map() // phone → L.circleMarker

  onMount(() => {
    // default center: Morocco
    map = L.map(mapContainer, {
      center: [33.9716, -6.8498],
      zoom: 8,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map)
  })

  // react to event_start — re-center map, draw impact circle
  createEffect(() => {
    if (!map || !event) return

    const { epicenter, radius_km, severity } = event
    const center = [epicenter.latitude, epicenter.longitude]

    // fly to epicenter
    map.flyTo(center, 10, { duration: 1.5 })

    // remove old circle + epicenter marker
    impactCircle?.remove()
    epicenterMarker?.remove()

    // draw impact radius circle
    impactCircle = L.circle(center, {
      radius:      radius_km * 1000, // km → metres
      color:       '#FF3B30',
      fillColor:   '#FF3B30',
      fillOpacity: 0.06,
      weight:      1.5,
      dashArray:   '6 4',
    }).addTo(map)

    // epicenter crosshair marker
    epicenterMarker = L.marker(center, {
      icon: L.divIcon({
        className: '',
        html: `<div class="epicenter-icon">✕</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
    }).addTo(map)
    epicenterMarker.bindPopup(
      `<b>Epicenter</b><br/>M${severity} ${event.disaster_type}<br/>${epicenter.latitude.toFixed(4)}, ${epicenter.longitude.toFixed(4)}`
    )
  })

  // react to device updates — add or update dots
  createEffect(() => {
    if (!map) return
    const allDevices = devices

    Object.values(allDevices).forEach(device => {
      const { phone, latitude, longitude, zone, reachable, sms_sent, rescue_flag } = device
      const color   = ZONE_COLORS[zone] ?? '#999'
      const opacity = reachable ? 0.9 : 0.35

      if (markerMap.has(phone)) {
        // update existing marker
        const marker = markerMap.get(phone)
        marker.setLatLng([latitude, longitude])
        marker.setStyle({ color, fillColor: color, fillOpacity: opacity })
        marker.getPopup()?.setContent(popupHTML(device))
      } else {
        // create new marker
        const marker = L.circleMarker([latitude, longitude], {
          radius:      rescue_flag ? 10 : 7,
          color,
          fillColor:   color,
          fillOpacity: opacity,
          weight:      rescue_flag ? 3 : 1.5,
        })
        marker.bindPopup(popupHTML(device))
        marker.addTo(map)
        markerMap.set(phone, marker)
      }
    })
  })

  return (
    <div
      ref={mapContainer}
      style={{ width: '100%', height: '100%' }}
    />
  )
}

function maskPhone(phone) {
  // +212612345678 → +212 6** *** 678
  if (phone.length < 6) return phone
  return phone.slice(0, 5) + '** *** ' + phone.slice(-3)
}

function popupHTML(d) {
  return `
    <div class="device-popup">
      <b>${maskPhone(d.phone)}</b>
      <div class="popup-row">Zone <span class="zone-tag zone-${d.zone}">${d.zone.toUpperCase()}</span></div>
      <div class="popup-row">${d.reachable   ? '📶 Reachable'   : '📵 Unreachable'}</div>
      <div class="popup-row">${d.sms_sent    ? '💬 SMS sent'    : '💬 No SMS'}</div>
      <div class="popup-row">${d.rescue_flag ? '🚁 Rescue flagged' : ''}</div>
    </div>
  `
}