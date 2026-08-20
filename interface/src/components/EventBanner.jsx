export default function EventBanner({ event, connected }) {
  return (
    <div class="event-banner">
      <div class="banner-left">
        <span class="app-title">🌍 GeoDispatch</span>
        <span class={`ws-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● LIVE' : '○ RECONNECTING...'}
        </span>
      </div>

      {event ? (
        <div class="banner-right">
          <span class="banner-chip disaster-type">{event.disaster_type.toUpperCase()}</span>
          <span class="banner-chip severity">M {event.severity}</span>
          <span class="banner-chip">📍 {event.epicenter.latitude.toFixed(4)}, {event.epicenter.longitude.toFixed(4)}</span>
          <span class="banner-chip">⭕ {event.radius_km} km</span>
          {event.tsunami_risk    && <span class="banner-chip warning">🌊 TSUNAMI RISK</span>}
          {event.aftershock_risk === 'HIGH' && <span class="banner-chip warning">⚠️ HIGH AFTERSHOCK</span>}
        </div>
      ) : (
        <div class="banner-right">
          <span class="banner-idle">Waiting for disaster event...</span>
        </div>
      )}
    </div>
  )
}