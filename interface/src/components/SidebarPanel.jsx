import { For } from 'solid-js'

export default function SidebarPanel({ zoneSummary, narratives }) {
  return (
    <div class="sidebar">
      <h2 class="sidebar-title">Zone Summary</h2>

      {/* counters */}
      <div class="zone-cards">
        <ZoneCard
          label="🔴 Red Zone"
          color="#FF3B30"
          total={zoneSummary?.red_total ?? '—'}
          reachable={zoneSummary?.red_reachable ?? '—'}
          rescue={zoneSummary?.red_rescue ?? '—'}
          showRescue={true}
        />
        <ZoneCard
          label="🟠 Orange Zone"
          color="#FF9500"
          total={zoneSummary?.orange_total ?? '—'}
          reachable={zoneSummary?.orange_reachable ?? '—'}
        />
        <ZoneCard
          label="🟢 Green Zone"
          color="#34C759"
          total={zoneSummary?.green_total ?? '—'}
          reachable={zoneSummary?.green_reachable ?? '—'}
        />
      </div>

      {/* AI narratives */}
      <h2 class="sidebar-title">Situation Report</h2>
      <div class="narratives">
        <For each={['red', 'orange', 'green']}>
          {(zone) => narratives[zone] && (
            <div class={`narrative narrative-${zone}`}>
              <div class="narrative-zone">{zone.toUpperCase()} ZONE</div>
              <p>{narratives[zone]}</p>
            </div>
          )}
        </For>
        {!Object.keys(narratives).length && (
          <p class="narrative-idle">Waiting for AI situation report...</p>
        )}
      </div>
    </div>
  )
}

function ZoneCard({ label, color, total, reachable, rescue, showRescue }) {
  return (
    <div class="zone-card" style={{ 'border-left': `4px solid ${color}` }}>
      <div class="zone-card-label">{label}</div>
      <div class="zone-card-stats">
        <span><b>{total}</b> total</span>
        <span><b>{reachable}</b> reachable</span>
        {showRescue && <span><b>{rescue ?? '—'}</b> rescue</span>}
      </div>
    </div>
  )
}