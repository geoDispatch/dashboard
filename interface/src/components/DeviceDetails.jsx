// Device details viewport — Figma 77:3 (400x936) + 77:2 ("Hide device details").
//
// Four white cards that are ALWAYS on screen: Device Overview, Status, Location,
// AI Decision. Until the operator clicks a dot on the map the cards keep their
// headings and icons and show a calm empty state in place of their rows — no
// zeros, no placeholders, no invented values.
//
// Contract rules enforced here (agent.md / BUILD_SPEC):
//   - phone numbers are always masked, never rendered raw;
//   - a zone is never encoded by colour alone — the zone WORD is always drawn;
//   - `shelter_name`, `confidence` and `rescue_priority` never arrive from the
//     live Go supervisor (only from the bundled demo stream). Missing means
//     DASH plus a muted "not sent by supervisor" note — never a guessed number;
//   - the AI's `reasoning` field is audit-only and is NEVER read or rendered
//     anywhere in this file.

import { createSignal, Show } from 'solid-js'

import {
  ACTION_LABELS,
  DASH,
  coords,
  deriveAction,
  km,
  maskPhone,
  percent,
  reachabilityLabel,
} from '../lib/format'
import { ZONE_COLORS, ZONE_LABELS } from '../constants/zones'

import overviewIcon from '../assets/icons/panel-device-overview.svg'
import statusIcon from '../assets/icons/panel-status.svg'
import locationIcon from '../assets/icons/panel-location.svg'
import aiIcon from '../assets/icons/panel-ai-decision.svg'
import minusIcon from '../assets/icons/panel-collapse-minus.svg'
import phoneIcon from '../assets/icons/device-phone.svg'
import zoneIcon from '../assets/icons/device-zone.svg'
import hideChevron from '../assets/icons/panel-hide-chevron.svg'

import './DeviceDetails.css'

// Statements, not apologies. One per card, so the panel never repeats itself.
const EMPTY_TEXT = {
  overview: 'No device selected. Pick a dot on the map to inspect it.',
  status: 'Reachability, SMS delivery and the rescue flag appear here once a device is picked.',
  location: 'Distance from the epicenter and coordinates appear here once a device is picked.',
  ai: 'The dispatch decision — action, shelter, confidence and priority — appears here once a device is picked.',
}

// Height of each card's filled row block, so the empty state holds the same
// space and the stack does not jump when a device is selected.
//   overview 2x24 + 8    status 3x24 + 2x12    location 2x24 + 12    ai 4x24 + 3x12
const EMPTY_HEIGHT = { overview: 56, status: 96, location: 60, ai: 132 }

const GAP_NOTE = 'not sent by supervisor'

function isNumber(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function collapseLabel(collapsed, title) {
  if (collapsed) return `Expand ${title}`
  return `Collapse ${title}`
}

// ---------------------------------------------------------------------------
// Hide / Show control — Figma 77:2, 84x44, chevron + label.
// ---------------------------------------------------------------------------

export function HideButton(props) {
  const label = () => {
    if (props.hidden) return 'Show'
    return 'Hide'
  }

  return (
    <button
      type="button"
      class="dd-hide"
      classList={{ 'dd-hide--show': !!props.hidden }}
      aria-expanded={!props.hidden}
      aria-label={`${label()} device details`}
      onClick={() => props.onClick && props.onClick()}
    >
      <span class="dd-hide__chevron">
        <img src={hideChevron} alt="" aria-hidden="true" />
      </span>
      <span class="dd-hide__label">{label()}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function EmptyState(props) {
  return (
    <p class="dd-empty" style={{ '--dd-empty-h': `${props.height}px` }}>
      {props.text}
    </p>
  )
}

// A label column fixed at 124px, then the value. `missing` marks one of the
// three backend gap fields, which renders DASH plus the muted note.
function DetailRow(props) {
  return (
    <div class="dd-row">
      <p class="dd-row__label">{props.label}</p>
      <div class="dd-row__value-col">
        <p class="dd-row__value" classList={{ 'is-missing': !!props.missing }}>
          {props.value}
        </p>
        <Show when={props.missing}>
          <p class="dd-row__note">{GAP_NOTE}</p>
        </Show>
      </div>
    </div>
  )
}

function DetailCard(props) {
  return (
    <section class="dd-card" aria-labelledby={`dd-title-${props.id}`}>
      <div class="dd-card__heading">
        <span class={`dd-card__icon dd-card__icon--${props.id}`}>
          <img src={props.icon} alt="" aria-hidden="true" />
        </span>
        <h2 class="dd-card__title" id={`dd-title-${props.id}`}>
          {props.title}
        </h2>
        <button
          type="button"
          class="dd-card__collapse"
          aria-expanded={!props.collapsed}
          aria-controls={`dd-body-${props.id}`}
          aria-label={collapseLabel(props.collapsed, props.title)}
          onClick={() => props.onToggle()}
        >
          <span class="dd-card__glyph" classList={{ 'is-plus': !!props.collapsed }}>
            <img src={minusIcon} alt="" aria-hidden="true" />
            <img class="dd-card__glyph-cross" src={minusIcon} alt="" aria-hidden="true" />
          </span>
        </button>
      </div>
      <Show when={!props.collapsed}>
        <div class="dd-card__body" id={`dd-body-${props.id}`}>
          {props.children}
        </div>
      </Show>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Device details viewport
// ---------------------------------------------------------------------------

export default function DeviceDetails(props) {
  // Collapsed cards, keyed by card id. Each card collapses independently.
  const [collapsed, setCollapsed] = createSignal({})
  const isCollapsed = (id) => collapsed()[id] === true
  const toggle = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))

  const device = () => props.device || null

  // Every accessor below is null-safe on its own, so a frame that arrives
  // half-built or a selection cleared mid-render can never print "undefined".

  const maskedPhone = () => maskPhone(device() && device().phone)

  const zoneKey = () => {
    const d = device()
    if (!d) return null
    if (!ZONE_LABELS[d.zone]) return null
    return d.zone
  }
  // The word, always — colour is only ever the second channel.
  const zoneLabel = () => {
    const z = zoneKey()
    if (!z) return DASH
    return ZONE_LABELS[z]
  }
  const zoneColor = () => {
    const z = zoneKey()
    if (!z) return 'var(--gd-ink-3, #525e6b)'
    return ZONE_COLORS[z]
  }

  const reachability = () => reachabilityLabel(device())

  const smsValue = () => {
    const d = device()
    if (!d) return DASH
    if (d.sms_sent) return 'Sent'
    return 'Not sent'
  }

  const rescueValue = () => {
    const d = device()
    if (!d) return DASH
    if (d.rescue_flag) return 'Flagged'
    return 'Not flagged'
  }

  // distance_km is derived by selectors.selectedDevice() from the epicenter;
  // before an event_start there is no epicenter, so it stays a dash.
  const distanceValue = () => {
    const d = device()
    if (!d || !isNumber(d.distance_km)) return DASH
    return `${km(d.distance_km)} from epicenter`
  }

  const coordsValue = () => {
    const d = device()
    if (!d) return DASH
    return coords(d.latitude, d.longitude)
  }

  const actionValue = () => {
    const d = device()
    if (!d) return DASH
    return ACTION_LABELS[d.action] || ACTION_LABELS[deriveAction(d)] || DASH
  }

  // --- the three backend gap fields -----------------------------------------

  const shelterMissing = () => {
    const d = device()
    return !d || !d.shelter_name
  }
  const shelterValue = () => {
    if (shelterMissing()) return DASH
    return device().shelter_name
  }

  const confidenceMissing = () => {
    const d = device()
    return !d || !isNumber(d.confidence)
  }
  const confidenceValue = () => {
    if (confidenceMissing()) return DASH
    return percent(device().confidence, 0)
  }

  const priorityMissing = () => {
    const d = device()
    return !d || !isNumber(d.rescue_priority)
  }
  const priorityValue = () => {
    if (priorityMissing()) return DASH
    const p = device().rescue_priority
    if (p <= 0) return 'None'
    return String(p)
  }

  return (
    <div class="dd">
      <Show
        when={!props.hidden}
        fallback={
          <HideButton hidden onClick={() => props.onToggleHidden && props.onToggleHidden()} />
        }
      >
        <div class="dd__stack" role="region" aria-label="Device details">
          <DetailCard
            id="overview"
            title="Device Overview"
            icon={overviewIcon}
            collapsed={isCollapsed('overview')}
            onToggle={() => toggle('overview')}
          >
            <Show
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.overview} text={EMPTY_TEXT.overview} />}
            >
              <div class="dd-identity">
                <div class="dd-identity__row">
                  <span class="dd-identity__icon">
                    <img src={phoneIcon} alt="" aria-hidden="true" />
                  </span>
                  <p class="dd-identity__phone">{maskedPhone()}</p>
                </div>
                <div class="dd-identity__row">
                  <span class="dd-identity__icon">
                    <img src={zoneIcon} alt="" aria-hidden="true" />
                  </span>
                  <p class="dd-identity__zone" style={{ color: zoneColor() }}>
                    {zoneLabel()}
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
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.status} text={EMPTY_TEXT.status} />}
            >
              <div class="dd-details">
                <DetailRow label="Reachability" value={reachability()} />
                <DetailRow label="SMS" value={smsValue()} />
                <DetailRow label="Rescue" value={rescueValue()} />
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
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.location} text={EMPTY_TEXT.location} />}
            >
              <div class="dd-details">
                <DetailRow label="Distance" value={distanceValue()} />
                <DetailRow label="Coordinates" value={coordsValue()} />
              </div>
            </Show>
          </DetailCard>

          <DetailCard
            id="ai"
            title="AI Decision"
            icon={aiIcon}
            collapsed={isCollapsed('ai')}
            onToggle={() => toggle('ai')}
          >
            <Show
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.ai} text={EMPTY_TEXT.ai} />}
            >
              <div class="dd-details">
                <DetailRow label="Action" value={actionValue()} />
                <DetailRow label="Shelter" value={shelterValue()} missing={shelterMissing()} />
                <DetailRow
                  label="Confidence"
                  value={confidenceValue()}
                  missing={confidenceMissing()}
                />
                <DetailRow label="Priority" value={priorityValue()} missing={priorityMissing()} />
              </div>
            </Show>
          </DetailCard>
        </div>

        <HideButton onClick={() => props.onToggleHidden && props.onToggleHidden()} />
      </Show>
    </div>
  )
}
