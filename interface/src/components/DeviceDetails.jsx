// Device details viewport — Figma 77:3 (400x936) + 77:2 ("Hide device details").
//
// Four white cards that are ALWAYS on screen: Device Overview, Status, Location,
// AI Decision. Until the operator clicks a dot on the map the cards keep their
// headings and icons and show a calm empty state in place of their rows — no
// zeros, no placeholders, no invented values.
//
// Contract rules enforced here (contract v2, device_update):
//   - phone numbers are always masked, never rendered raw;
//   - a zone is never encoded by colour alone — the zone WORD is always drawn;
//   - the zone is Go's haversine band. An AI escalation is shown as a note
//     beside it, never in its place;
//   - `action`, `confidence` are null until the AI has decided; null renders as
//     DASH with a note saying why, never a guessed number;
//   - "SMS" is what the gateway did (sms_status), not what the AI asked for;
//   - the AI's `reasoning` field never reaches the browser and is NEVER read or
//     rendered anywhere in this file.

import { createSignal, Show } from 'solid-js'

import { DASH, maskPhone, percent } from '../lib/format'
import { ZONE_LABELS, ZONE_TEXT } from '../constants/zones'
import { useDisplay } from '../lib/settings'
import { enumLabel, reachabilityText, useT } from '../lib/i18n'

// Icons are inlined with Vite's `?raw` suffix and written into a sized <span>
// with innerHTML. An <img src="...svg"> is an isolated document and cannot see
// this page's `color`, so `stroke="currentColor"` inside it would resolve to
// black; inlined, the colour cascades in and hover/active/disabled states work.
import overviewIcon from '../assets/icons/panel-device-overview.svg?raw'
import statusIcon from '../assets/icons/panel-status.svg?raw'
import locationIcon from '../assets/icons/panel-location.svg?raw'
import aiIcon from '../assets/icons/panel-ai-decision.svg?raw'
import minusIcon from '../assets/icons/panel-collapse-minus.svg?raw'
import phoneIcon from '../assets/icons/device-phone.svg?raw'
import zoneIcon from '../assets/icons/device-zone.svg?raw'
import hideChevron from '../assets/icons/panel-hide-chevron.svg?raw'

import './DeviceDetails.css'

// Statements, not apologies. One per card, so the panel never repeats itself.
// Dictionary keys (lib/i18n.js).
const EMPTY_TEXT = {
  overview: 'device.emptyOverview',
  status: 'device.emptyStatus',
  location: 'device.emptyLocation',
  ai: 'device.emptyAi',
}

// Height of each card's filled row block, so the empty state holds the same
// space and the stack does not jump when a device is selected.
//   overview 2x24 + 8    status 4x24 + 3x12    location 3x24 + 2x12    ai 3x24 + 2x12
const EMPTY_HEIGHT = { overview: 56, status: 132, location: 96, ai: 96 }

// Why a decision field is empty, by stage. Only `decided` carries one.
const UNDECIDED_NOTE = {
  triaged:         'device.awaitingDecision',
  decision_failed: 'device.decisionFailed',
}

function isNumber(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function collapseLabel(t, collapsed, title) {
  if (collapsed) return t('device.expand', title)
  return t('device.collapse', title)
}

// ---------------------------------------------------------------------------
// Hide / Show control — Figma 77:2, 84x44, chevron + label.
// ---------------------------------------------------------------------------

export function HideButton(props) {
  const t = useT()
  const label = () => {
    if (props.hidden) return t('device.show')
    return t('device.hide')
  }

  return (
    <button
      type="button"
      class="dd-hide"
      classList={{ 'dd-hide--show': !!props.hidden }}
      aria-expanded={!props.hidden}
      aria-label={t('device.toggleLabel', label())}
      onClick={() => props.onClick && props.onClick()}
    >
      <span class="dd-hide__chevron" aria-hidden="true" innerHTML={hideChevron} />
      <span class="dd-hide__label">{label()}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export function EmptyState(props) {
  return (
    <p class="dd-empty" style={{ '--dd-empty-h': `${props.height}px` }}>
      {props.text}
    </p>
  )
}

// A label column fixed at 124px, then the value. `missing` mutes a value that
// is not there (DASH); `note` is a muted line under the value saying why, or
// qualifying it.
export function DetailRow(props) {
  return (
    <div class="dd-row">
      <p class="dd-row__label">{props.label}</p>
      <div class="dd-row__value-col">
        <p class="dd-row__value" classList={{ 'is-missing': !!props.missing }}>
          {props.value}
        </p>
        <Show when={props.note}>
          <p class="dd-row__note">{props.note}</p>
        </Show>
      </div>
    </div>
  )
}

export function DetailCard(props) {
  const t = useT()
  return (
    <section class="dd-card" aria-labelledby={`dd-title-${props.id}`}>
      <div class="dd-card__heading">
        <span
          class={`dd-card__icon dd-card__icon--${props.id}`}
          aria-hidden="true"
          innerHTML={props.icon}
        />
        <h2 class="dd-card__title" id={`dd-title-${props.id}`}>
          {props.title}
        </h2>
        <button
          type="button"
          class="dd-card__collapse"
          aria-expanded={!props.collapsed}
          aria-controls={`dd-body-${props.id}`}
          aria-label={collapseLabel(t, props.collapsed, props.title)}
          onClick={() => props.onToggle()}
        >
          <span class="dd-card__glyph" classList={{ 'is-plus': !!props.collapsed }}>
            <span class="dd-card__glyph-icon" aria-hidden="true" innerHTML={minusIcon} />
            <span
              class="dd-card__glyph-icon dd-card__glyph-cross"
              aria-hidden="true"
              innerHTML={minusIcon}
            />
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

  // Coordinates and distances are drawn the way the operator asked for them
  // in settings; every screen reads the same formatters so they cannot drift.
  const fmt = useDisplay()
  const t = useT()

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
    return t(`zone.${z}`)
  }
  // The WORD's colour, theme-aware — the dark themes lift the pure zone hues
  // so the word clears contrast on their cards. See ZONE_TEXT in constants/zones.js.
  const zoneColor = () => {
    const z = zoneKey()
    if (!z) return 'var(--gd-ink-3, #525e6b)'
    return ZONE_TEXT[z]
  }

  // "AI escalation to Red zone" — a display annotation from the AI. The zone
  // above it stays the one Go computed.
  const escalationNote = () => {
    const d = device()
    if (!d || !d.zone_escalated || !ZONE_LABELS[d.escalated_zone]) return null
    return t('device.escalation', t(`zone.${d.escalated_zone}`))
  }

  // CAMARA's answer, with "(assumed — lookup failed)" when there was none.
  const reachability = () => reachabilityText(t, device())

  const stageValue = () => enumLabel(t, 'stage', device()?.stage)

  // What the gateway did, in words: "Not sent — no SMS gateway configured" is
  // a different fact from "Failed", and neither is "Sent".
  const smsValue = () => enumLabel(t, 'sms', device()?.sms_status)

  const rescueValue = () => {
    const d = device()
    if (!d) return DASH
    if (!d.rescue_flag) return t('device.notFlagged')
    return t('device.flaggedWith', enumLabel(t, 'rescueStatus', d.rescue_status))
  }

  // The supervisor's own haversine distance; selectors only compute one as a
  // fallback when it is missing, and the note says so.
  const distanceValue = () => {
    const d = device()
    if (!d || !isNumber(d.distance_km)) return DASH
    return t('distance.fromEpicenter', fmt.distance(d.distance_km))
  }
  const distanceNote = () =>
    device()?.distanceSource === 'computed' ? t('device.computedNote') : null

  const coordsValue = () => {
    const d = device()
    if (!d) return DASH
    return fmt.coords(d.latitude, d.longitude)
  }

  // CAMARA reports an area, not a point: the coordinates are its centre and
  // this is its radius.
  const accuracyValue = () => {
    const d = device()
    if (!d || !isNumber(d.location_accuracy_m)) return DASH
    return `± ${fmt.distance(d.location_accuracy_m / 1000, 2)}`
  }

  // --- decision fields: null until stage == decided ------------------------

  const undecided = () => {
    const d = device()
    return !d || d.stage !== 'decided'
  }
  const undecidedNote = () => {
    const key = UNDECIDED_NOTE[device()?.stage]
    return key ? t(key) : null
  }

  const actionValue = () => enumLabel(t, 'action', device()?.action)

  const confidenceMissing = () => {
    const d = device()
    return !d || !isNumber(d.confidence)
  }
  const confidenceValue = () => {
    if (confidenceMissing()) return DASH
    return percent(device().confidence, 0)
  }

  // 0 means "no rescue priority"; 1 is the most urgent.
  const priorityValue = () => {
    const d = device()
    if (!d || !isNumber(d.rescue_priority)) return DASH
    if (d.rescue_priority <= 0) return t('device.priorityNone')
    return String(d.rescue_priority)
  }

  return (
    <div class="dd">
      <Show
        when={!props.hidden}
        fallback={
          <HideButton hidden onClick={() => props.onToggleHidden && props.onToggleHidden()} />
        }
      >
        <div class="dd__stack" role="region" aria-label={t('device.detailsRegion')}>
          <DetailCard
            id="overview"
            title={t('device.overview')}
            icon={overviewIcon}
            collapsed={isCollapsed('overview')}
            onToggle={() => toggle('overview')}
          >
            <Show
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.overview} text={t(EMPTY_TEXT.overview)} />}
            >
              <div class="dd-identity">
                <div class="dd-identity__row">
                  <span class="dd-identity__icon" aria-hidden="true" innerHTML={phoneIcon} />
                  <p class="dd-identity__phone">{maskedPhone()}</p>
                </div>
                <div class="dd-identity__row">
                  <span class="dd-identity__icon" aria-hidden="true" innerHTML={zoneIcon} />
                  <p class="dd-identity__zone" style={{ color: zoneColor() }}>
                    {zoneLabel()}
                  </p>
                </div>
                <Show when={escalationNote()}>
                  <p class="dd-row__note dd-identity__note">{escalationNote()}</p>
                </Show>
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
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.status} text={t(EMPTY_TEXT.status)} />}
            >
              <div class="dd-details">
                <DetailRow label={t('device.reachability')} value={reachability()} />
                <DetailRow label={t('device.stage')} value={stageValue()} />
                <DetailRow label={t('device.sms')} value={smsValue()} />
                <DetailRow label={t('device.rescue')} value={rescueValue()} />
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
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.location} text={t(EMPTY_TEXT.location)} />}
            >
              <div class="dd-details">
                <DetailRow label={t('device.distance')} value={distanceValue()} note={distanceNote()} />
                <DetailRow label={t('device.coordinates')} value={coordsValue()} />
                <DetailRow label={t('device.accuracy')} value={accuracyValue()} />
              </div>
            </Show>
          </DetailCard>

          <DetailCard
            id="ai"
            title={t('device.aiDecision')}
            icon={aiIcon}
            collapsed={isCollapsed('ai')}
            onToggle={() => toggle('ai')}
          >
            <Show
              when={device()}
              fallback={<EmptyState height={EMPTY_HEIGHT.ai} text={t(EMPTY_TEXT.ai)} />}
            >
              <div class="dd-details">
                <DetailRow
                  label={t('device.action')}
                  value={actionValue()}
                  missing={undecided()}
                  note={undecidedNote()}
                />
                <DetailRow label={t('device.priority')} value={priorityValue()} />
                <DetailRow
                  label={t('device.confidence')}
                  value={confidenceValue()}
                  missing={confidenceMissing()}
                  note={undecided() ? undecidedNote() : null}
                />
              </div>
            </Show>
          </DetailCard>
        </div>

        <HideButton onClick={() => props.onToggleHidden && props.onToggleHidden()} />
      </Show>
    </div>
  )
}
