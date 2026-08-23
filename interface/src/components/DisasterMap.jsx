import { onMount, createEffect } from 'solid-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ZONE_COLORS } from '../constants/zones'

export default function DisasterMap(props) {
  let mapContainer
  let map
  let impactCircle = null
  let epicenterMarker = null
  const markerMap = new Map()

  onMount(() => {
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

  createEffect(() => {
    const currentEvent = props.event
    if (!map || !currentEvent) return

    const { epicenter, radius_km, severity, disaster_type } = currentEvent
    const center = [epicenter.latitude, epicenter.longitude]

    map.flyTo(center, 10, { duration: 1.5 })

    impactCircle?.remove()
    epicenterMarker?.remove()

    impactCircle = L.circle(center, {
      radius:      radius_km * 1000,
      color:       '#FF3B30',
      fillColor:   '#FF3B30',
      fillOpacity: 0.06,
      weight:      1.5,
      dashArray:   '6 4',
    }).addTo(map)

    epicenterMarker = L.marker(center, {
      icon: L.divIcon({
        className: '',
        html: `<div class="epicenter-icon">✕</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
    }).addTo(map)

    epicenterMarker.bindPopup(
      `<b>Epicenter</b><br/>M${severity} ${disaster_type}<br/>${epicenter.latitude.toFixed(4)}, ${epicenter.longitude.toFixed(4)}`
    )
  })

  createEffect(() => {
    if (!map) return
    const allDevices = props.devices || {}

    Object.values(allDevices).forEach(device => {
      const { phone, latitude, longitude, zone, reachable, sms_sent, rescue_flag } = device
      const color   = ZONE_COLORS[zone] ?? '#999'
      const opacity = reachable ? 0.9 : 0.35

      if (markerMap.has(phone)) {
        const marker = markerMap.get(phone)
        marker.setLatLng([latitude, longitude])
        marker.setStyle({ color, fillColor: color, fillOpacity: opacity })
        marker.getPopup()?.setContent(popupHTML(device))
      } else {
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
  if (!phone || phone.length < 6) return phone || ''
  return phone.slice(0, 5) + '** *** ' + phone.slice(-3)
}

function popupHTML(d) {
  return `
    <div class="device-popup">
      <b>${maskPhone(d.phone)}</b>
      <div class="popup-row">Zone <span class="zone-tag zone-${d.zone}">${d.zone ? d.zone.toUpperCase() : ''}</span></div>
      <div class="popup-row">${d.reachable   ? '📶 Reachable'   : '📵 Unreachable'}</div>
      <div class="popup-row">${d.sms_sent    ? '💬 SMS sent'    : '💬 No SMS'}</div>
      <div class="popup-row">${d.rescue_flag ? '🚁 Rescue flagged' : ''}</div>
    </div>
  `
}