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
import { ZONE_TEXT } from '../constants/zones'
import { useDisplay } from '../lib/settings'
import { num, titleCase, DASH } from '../lib/format'
import { enumLabel, severityText, useT } from '../lib/i18n'

// `?raw` + innerHTML, the same technique DeviceDetails uses: an <img> cannot
// inherit `color`, so the icons are inlined and stroke="currentColor" resolves
// against this page.
import overviewIcon from '../assets/icons/panel-device-overview.svg?raw'
import statusIcon from '../assets/icons/panel-status.svg?raw'
import locationIcon from '../assets/icons/panel-location.svg?raw'
import aiIcon from '../assets/icons/panel-ai-decision.svg?raw'
import zoneIcon from '../assets/icons/device-zone.svg?raw'

import './DeviceDetails.css'

// Words for the disaster types and the zones are dictionary keys
// (lib/i18n.js): disasterTitle.*, zone.*, zoneMeaning.*. Only three zones
// exist. Go assigns them by haversine; the dashboard never computes or
// reassigns a zone.
const EMPTY_TEXT = {
  overview: 'zoneDetails.emptyOverview',
  status:   'zoneDetails.emptyStatus',
  location: 'zoneDetails.emptyLocation',
  ai:       'zoneDetails.emptyAi',
}

const EMPTY_HEIGHT = { overview: 56, status: 96, location: 60, ai: 96 }

export default function ZoneDetails(props) {
  const fmt = useDisplay()
  const t = useT()

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
    return enumLabel(t, 'disasterTitle', e.disaster_type, titleCase(e.disaster_type))
  }

  // Only an earthquake has a magnitude; the other types' severity is an index
  // on no named scale, so it must not say "M". See severityLabel in lib/format.
  const severityLabel = () => severityText(t, event()?.disaster_type, event()?.severity)

  // "Red zone: Critical: immediate danger"
  const zoneLine = () =>
    `${enumLabel(t, 'zone', zone())}: ${enumLabel(t, 'zoneMeaning', zone(), '')}`

  // ── status ───────────────────────────────────────────────────────────────
  const inZone = () => counts()?.byZone?.[zone()] || null

  const reachableText = () => {
    const c = inZone()
    if (!c || !c.total) return DASH
    return t('zoneDetails.reachableOf', num(c.reachable), num(c.total))
  }

  // Rescue flags are the AI's call per device and are independent of the band:
  // an orange or green device can be flagged too, so every band counts its own.
  const rescueText = () => {
    const c = inZone()
    if (!c) return DASH
    return t('ops.flaggedCount', num(c.rescue))
  }

  const aftershockText = () => {
    const e = event()
    if (!e?.aftershock_risk) return DASH
    return enumLabel(t, 'risk', e.aftershock_risk, titleCase(e.aftershock_risk))
  }

  // ── location ─────────────────────────────────────────────────────────────
  const bandText = () => {
    const e = event()
    if (!e?.radius_km || !zone()) return DASH
    // The band edges the supervisor sent with event_start (props.bands), so the
    // words match the rings on the map and the zones Go assigned.
    return t('distance.fromEpicenter', fmt.band(zone(), e.radius_km, props.bands))
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
        <div class="dd__stack" role="region" aria-label={t('zoneDetails.region')}>
        <DetailCard
          id="overview"
          title={t('zoneDetails.overview')}
          icon={overviewIcon}
          collapsed={isCollapsed('overview')}
          onToggle={() => toggle('overview')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.overview} text={t(EMPTY_TEXT.overview)} />}
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
                  {zoneLine()}
                </p>
              </div>
            </div>
          </Show>
        </DetailCard>

        <DetailCard
          id="status"
          title={t('device.status')}
          icon={statusIcon}
          collapsed={isCollapsed('status')}
          onToggle={() => toggle('status')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.status} text={t(EMPTY_TEXT.status)} />}
          >
            <div class="dd-details">
              <DetailRow label={t('zoneDetails.devices')} value={num(inZone()?.total)} />
              <DetailRow label={t('zoneDetails.reachable')} value={reachableText()} />
              <DetailRow label={t('zoneDetails.rescue')} value={rescueText()} />
              <DetailRow label={t('zoneDetails.aftershock')} value={aftershockText()} />
              <Show when={event()?.tsunami_risk}>
                <DetailRow label={t('zoneDetails.tsunami')} value={t('zoneDetails.coastalRisk')} />
              </Show>
            </div>
          </Show>
        </DetailCard>

        <DetailCard
          id="location"
          title={t('device.location')}
          icon={locationIcon}
          collapsed={isCollapsed('location')}
          onToggle={() => toggle('location')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.location} text={t(EMPTY_TEXT.location)} />}
          >
            <div class="dd-details">
              <DetailRow label={t('zoneDetails.band')} value={bandText()} />
              <DetailRow label={t('zoneDetails.epicenter')} value={epicentreText()} />
              <DetailRow label={t('zoneDetails.radius')} value={radiusText()} />
            </div>
          </Show>
        </DetailCard>

        <DetailCard
          id="ai"
          title={t('zoneDetails.ai')}
          icon={aiIcon}
          collapsed={isCollapsed('ai')}
          onToggle={() => toggle('ai')}
        >
          <Show
            when={hasEvent()}
            fallback={<EmptyState height={EMPTY_HEIGHT.ai} text={t(EMPTY_TEXT.ai)} />}
          >
            <Show
              when={props.narrative}
              fallback={
                <EmptyState
                  height={EMPTY_HEIGHT.ai}
                  text={t('zoneDetails.waiting')}
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
