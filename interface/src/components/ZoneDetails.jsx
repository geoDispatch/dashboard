// Zone details — what the operator gets when they click a zone ring on the map
// rather than a device dot.
//
// A device answers "who is this person and what was decided for them". A zone
// answers "what is happening in this band" — the disaster itself, how many
// people are inside it, and the AI's situation report for that band. Same four
// cards, same primitives, same design as the device panel: the panel does not
// change shape depending on what you clicked, only what it says.

import { createSignal, Show } from 'solid-js'
import { DetailCard, DetailRow, EmptyState, HideButton } from './DeviceDetails'
import { ZONE_LABELS, ZONE_MEANING, ZONE_TEXT } from '../constants/zones'
import { useDisplay } from '../lib/settings'
import { decimal, num, titleCase, DASH } from '../lib/format'

// `?raw` + innerHTML, the same technique DeviceDetails uses: an <img> cannot
// inherit `color`, so the icons are inlined and stroke="currentColor" resolves
// against this page.
import overviewIcon from '../assets/icons/panel-device-overview.svg?raw'
import statusIcon from '../assets/icons/panel-status.svg?raw'
import locationIcon from '../assets/icons/panel-location.svg?raw'
import aiIcon from '../assets/icons/panel-ai-decision.svg?raw'
import zoneIcon from '../assets/icons/device-zone.svg?raw'

import './DeviceDetails.css'

// Only these three exist. Go assigns them by haversine; the dashboard never
// computes or reassigns a zone.
const DISASTER_LABELS = {
  earthquake: 'Earthquake',
  flood:      'Flood',
  heatwave:   'Heatwave',
}

const EMPTY_TEXT = {
  overview: 'Select a zone on the map.',
  status:   'Select a zone to view device counts.',
  location: 'Select a zone to view its location.',
  ai:       'Select a zone to view its situation report.',
}

const EMPTY_HEIGHT = { overview: 56, status: 96, location: 60, ai: 96 }

export default function ZoneDetails(props) {
  const fmt = useDisplay()

  const [collapsed, setCollapsed] = createSignal({})

  const isCollapsed = (id) => !!collapsed()[id]
  const toggle = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))

  const zone = () => props.zone || null
  const event = () => props.event || null
  const counts = () => props.counts || null
  // The word's colour — theme-aware. See ZONE_TEXT in constants/zones.js.
  const color = () => ZONE_TEXT[zone()] || 'var(--gd-ink)'

  // ── overview ─────────────────────────────────────────────────────────────
  const disasterLabel = () => {
    const e = event()
    if (!e?.disaster_type) return DASH
    return DISASTER_LABELS[e.disaster_type] || titleCase(e.disaster_type)
  }

  // Magnitude is the Richter value for a quake; for the other two disaster
  // types the same field is a severity index, so it must not say "M".
  const severityLabel = () => {
    const e = event()
    if (typeof e?.severity !== 'number') return DASH
    return e.disaster_type === 'earthquake'
      ? `M ${decimal(e.severity, 1)}`
      : `Severity ${decimal(e.severity, 1)}`
  }

  // ── status ───────────────────────────────────────────────────────────────
  const inZone = () => counts()?.byZone?.[zone()] || null

  const reachableText = () => {
    const c = inZone()
    if (!c || !c.total) return DASH
    return `${num(c.reachable)} of ${num(c.total)}`
  }

  // Only the red band ever carries rescue flags — that asymmetry is by design,
  // so the other two say so rather than showing a zero that looks like data.
  const rescueText = () => {
    const c = inZone()
    if (!c) return DASH
    if (zone() !== 'red') return 'None in this band'
    return `${num(c.rescue)} flagged`
  }

  const aftershockText = () => {
    const e = event()
    if (!e?.aftershock_risk) return DASH
    return titleCase(e.aftershock_risk)
  }

  // ── location ─────────────────────────────────────────────────────────────
  const bandText = () => {
    const e = event()
    if (!e?.radius_km || !zone()) return DASH
    return `${fmt.band(zone(), e.radius_km)} from epicenter`
  }

  const epicentreText = () => {
    const e = event()
    if (!e?.epicenter) return DASH
    return fmt.coords(e.epicenter.latitude, e.epicenter.longitude)
  }

  const radiusText = () => {
    const e = event()
    return typeof e?.radius_km === 'number' ? fmt.distance(e.radius_km) : DASH
  }

  const hasEvent = () => !!event() && !!zone()

  return (
    <div class="dd">
      <Show
        when={!props.hidden}
        fallback={<HideButton hidden onClick={() => props.onToggleHidden && props.onToggleHidden()} />}
      >
        <div class="dd__stack" role="region" aria-label="Zone details">
        <DetailCard
          id="overview"
          title="Zone Overview"
          icon={overviewIcon}
          collapsed={isCollapsed('overview')}
          onToggle={() => toggle('overview')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.overview} text={EMPTY_TEXT.overview} />}
          >
            <div class="dd-identity">
              <div class="dd-identity__row">
                <span class="dd-identity__icon" aria-hidden="true" innerHTML={zoneIcon} />
                <p class="dd-identity__phone">
                  {disasterLabel()} · {severityLabel()}
                </p>
              </div>
              <div class="dd-identity__row">
                <span class="dd-identity__icon" aria-hidden="true" innerHTML={zoneIcon} />
                <p class="dd-identity__zone" style={{ color: color() }}>
                  {ZONE_LABELS[zone()]}: {ZONE_MEANING[zone()]}
                </p>
              </div>
            </div>
          </Show>
        </DetailCard>

        <DetailCard
          id="status"
          title="Status"
          icon={statusIcon}
          collapsed={isCollapsed('status')}
          onToggle={() => toggle('status')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.status} text={EMPTY_TEXT.status} />}
          >
            <div class="dd-details">
              <DetailRow label="Devices" value={num(inZone()?.total)} />
              <DetailRow label="Reachable" value={reachableText()} />
              <DetailRow label="Rescue" value={rescueText()} />
              <DetailRow label="Aftershock" value={aftershockText()} />
              <Show when={event()?.tsunami_risk}>
                <DetailRow label="Tsunami" value="Coastal risk present" />
              </Show>
            </div>
          </Show>
        </DetailCard>

        <DetailCard
          id="location"
          title="Location"
          icon={locationIcon}
          collapsed={isCollapsed('location')}
          onToggle={() => toggle('location')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.location} text={EMPTY_TEXT.location} />}
          >
            <div class="dd-details">
              <DetailRow label="Band" value={bandText()} />
              <DetailRow label="Epicenter" value={epicentreText()} />
              <DetailRow label="Impact radius" value={radiusText()} />
            </div>
          </Show>
        </DetailCard>

        <DetailCard
          id="ai"
          title="AI Situation Report"
          icon={aiIcon}
          collapsed={isCollapsed('ai')}
          onToggle={() => toggle('ai')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.ai} text={EMPTY_TEXT.ai} />}
          >
            <Show
              when={props.narrative}
              fallback={
                <EmptyState
                  height={EMPTY_HEIGHT.ai}
                  text="Waiting for the first zone report."
                />
              }
            >
              <p class="dd-narrative">{props.narrative}</p>
            </Show>
          </Show>
        </DetailCard>
        </div>

        <HideButton onClick={() => props.onToggleHidden && props.onToggleHidden()} />
      </Show>
    </div>
  )
}
