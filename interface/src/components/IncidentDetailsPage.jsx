// Incident details — the rail's full-page view of one event.
//
// The map answers "where". This page answers "who, and what was decided".
// It reads the same store the map draws from, laid out as a reading surface:
// the event's own facts, one column per zone carrying that zone's counts next
// to the AI's report for it, the full triage table, then shelters and the
// telecom picture.
//
// The house rules hold here exactly as they do in the panels:
//   - a phone number only ever reaches the screen through maskPhone();
//   - a zone always carries its WORD — colour is never the only channel;
//   - a value the supervisor does not send renders as a dash and says so,
//     rather than being filled in with something plausible;
//   - the AI `reasoning` field is never read.
//
// SolidJS: props are never destructured, lists go through <For>, branches
// through <Show>.

import { For, Show, createMemo, createSignal } from 'solid-js'

import {
  ACTION_LABELS,
  DASH,
  ago,
  decimal,
  deriveAction,
  maskPhone,
  num,
  percent,
  reachabilityLabel,
} from '../lib/format'
import {
  ZONE_COLORS,
  ZONE_LABELS,
  ZONE_MEANING,
  ZONE_ORDER,
} from '../constants/zones'
import { useDisplay } from '../lib/settings'
import { SOURCE_LABEL, streamChip } from '../lib/streamState'
import { haversine } from '../lib/geo'

import searchIcon from '../assets/icons/search.svg?raw'
import mapIcon from '../assets/icons/nav-map.svg?raw'

import './IncidentDetailsPage.css'

// A page of rows, not the whole population. The stream reaches five figures in
// a 50 km radius (agent.md §11) and a table that renders every row of that is
// a table nobody can read and a DOM nobody can scroll.
const PAGE_SIZE = 50

const ZONE_FILTERS = [
  { key: 'all',    label: 'All' },
  { key: 'red',    label: 'Red' },
  { key: 'orange', label: 'Orange' },
  { key: 'green',  label: 'Green' },
  { key: 'rescue', label: 'Rescue' },
]

// Red first, because that is the order the supervisor dispatches in.
const ZONE_RANK = { red: 0, orange: 1, green: 2 }

function isNumber(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function priorityOf(device) {
  if (!isNumber(device.rescue_priority) || device.rescue_priority <= 0) return null
  return device.rescue_priority
}

export default function IncidentDetailsPage(props) {
  // Coordinates, distances and zone bands follow the operator's settings.
  const fmt = useDisplay()

  const [search, setSearch] = createSignal('')
  const [zoneFilter, setZoneFilter] = createSignal('all')
  const [sortKey, setSortKey] = createSignal('distance')
  const [sortDir, setSortDir] = createSignal('asc')
  const [page, setPage] = createSignal(0)

  // ── distance ──────────────────────────────────────────────────────────
  // distance_km is not on the wire; this is the same haversine Go runs. Sorting
  // needs it for every row, on every batch, so the answer is cached per phone —
  // and invalidated if that phone is relocated or a new epicentre arrives,
  // because CAMARA can move a device between its triage and dispatch frames.
  let distCache = new Map()
  let distEpicentre = null

  function distanceOf(device) {
    const epi = props.event && props.event.epicenter
    if (!epi || !device) return null
    if (distEpicentre !== epi) {
      distCache = new Map()
      distEpicentre = epi
    }
    const hit = distCache.get(device.phone)
    if (hit && hit.lat === device.latitude && hit.lng === device.longitude) return hit.km
    const value = haversine(
      { latitude: device.latitude, longitude: device.longitude },
      epi,
    )
    distCache.set(device.phone, { lat: device.latitude, lng: device.longitude, km: value })
    return value
  }

  // ── data ──────────────────────────────────────────────────────────────
  const allDevices = createMemo(() => Object.values(props.devices || {}))
  const counts = () => props.counts || null
  const zoneCount = (zone) => (counts() && counts().byZone ? counts().byZone[zone] : null)

  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase()
    const filter = zoneFilter()

    return allDevices().filter((device) => {
      if (filter === 'rescue') {
        if (!device.rescue_flag) return false
      } else if (filter !== 'all' && device.zone !== filter) {
        return false
      }
      if (!q) return true

      const haystack = `${maskPhone(device.phone)} ${device.zone || ''} ${
        ZONE_LABELS[device.zone] || ''
      } ${device.shelter_name || ''}`
      return haystack.toLowerCase().includes(q)
    })
  })

  const sorted = createMemo(() => {
    const key = sortKey()
    const sign = sortDir() === 'asc' ? 1 : -1

    return filtered().slice().sort((a, b) => {
      let d = 0
      if (key === 'phone') {
        d = String(a.phone || '').localeCompare(String(b.phone || ''))
      } else if (key === 'zone') {
        d = (ZONE_RANK[a.zone] ?? 9) - (ZONE_RANK[b.zone] ?? 9)
      } else if (key === 'distance') {
        d = (distanceOf(a) ?? Infinity) - (distanceOf(b) ?? Infinity)
      } else if (key === 'reach') {
        d = Number(!!b.reachable) - Number(!!a.reachable)
      } else if (key === 'priority') {
        d = (priorityOf(a) ?? 99) - (priorityOf(b) ?? 99)
      } else if (key === 'confidence') {
        d = (isNumber(b.confidence) ? b.confidence : -1) -
            (isNumber(a.confidence) ? a.confidence : -1)
      }
      // Distance breaks every tie: it is the only ordering the supervisor
      // itself uses, so the table never shuffles rows at random.
      if (d === 0) d = (distanceOf(a) ?? Infinity) - (distanceOf(b) ?? Infinity)
      return d * sign
    })
  })

  const pageCount = createMemo(() => Math.max(1, Math.ceil(sorted().length / PAGE_SIZE)))
  // The list shrinks under a filter and grows as the stream runs, so the page
  // number is clamped on read rather than corrected on write.
  const safePage = createMemo(() => Math.min(page(), pageCount() - 1))
  const pageStart = () => safePage() * PAGE_SIZE

  // Raw store objects, deliberately: the supervisor merges device updates in
  // place, so these references are stable and <For> updates the cells that
  // changed instead of rebuilding every row on every frame.
  const pageDevices = createMemo(() => sorted().slice(pageStart(), pageStart() + PAGE_SIZE))

  function sortBy(key) {
    if (sortKey() === key) {
      setSortDir(sortDir() === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  function applySearch(value) {
    setSearch(value)
    setPage(0)
  }

  function applyZoneFilter(key) {
    setZoneFilter(key)
    setPage(0)
  }

  // The table has its own viewport so the column header can stay put over a
  // long page. Turning the page returns it to the first row.
  let tableEl

  function goToPage(next) {
    setPage(next)
    if (tableEl) tableEl.scrollTop = 0
  }

  function openOnMap(phone) {
    if (props.onSelectDevice) props.onSelectDevice(phone)
    if (props.onSwitchToMap) props.onSwitchToMap()
  }

  // ── shelters ──────────────────────────────────────────────────────────
  // Two different numbers, kept apart on purpose. `occupied` is the scenario's
  // own standing figure; `routed` is how many devices the AI has pointed at
  // this shelter in the stream. Adding them together would invent a third.
  const routed = createMemo(() => {
    const tally = {}
    for (const device of allDevices()) {
      if (device.shelter_name) {
        tally[device.shelter_name] = (tally[device.shelter_name] || 0) + 1
      }
    }
    return tally
  })

  const shelters = createMemo(() =>
    (props.shelters || []).map((shelter) => {
      const rate =
        isNumber(shelter.occupied) && isNumber(shelter.capacity) && shelter.capacity > 0
          ? shelter.occupied / shelter.capacity
          : null
      return {
        ...shelter,
        rate,
        routed: routed()[shelter.name] || 0,
        word: rate === null ? DASH : rate >= 1 ? 'At capacity' : rate >= 0.9 ? 'Nearly full' : 'Space free',
        full: rate !== null && rate >= 1,
      }
    }),
  )

  // ── header facts ──────────────────────────────────────────────────────
  const riskTone = (risk) =>
    risk === 'HIGH' ? 'red' : risk === 'MEDIUM' ? 'orange' : risk === 'LOW' ? 'green' : null

  return (
    <div class="idp">
      {/* ── Header — fixed, so the event never scrolls out of sight ──────── */}
      <header class="idp-head">
        <div class="idp-head__id">
          <h1 class="idp-head__title">Incident details</h1>
          <Show
            when={props.event && props.event.event_id}
            fallback={<span class="idp-head__sub">No active event</span>}
          >
            {(id) => (
              <span class="idp-head__sub">
                <span class="idp-chip">{id()}</span>
                <span class="idp-head__meta">
                  <span class="is-capital">{props.event.disaster_type || DASH}</span>
                  {isNumber(props.event.severity) ? ` · M ${decimal(props.event.severity, 1)}` : ''}
                  {isNumber(props.event.radius_km) ? ` · ${fmt.distance(props.event.radius_km, 0)} radius` : ''}
                </span>
              </span>
            )}
          </Show>
        </div>

        <button type="button" class="idp-ghost" onClick={() => props.onSwitchToMap && props.onSwitchToMap()}>
          <span class="idp-ghost__icon" innerHTML={mapIcon} aria-hidden="true" />
          Back to the map
        </button>
      </header>

      <div class="idp-body">
        {/* ── Event facts ─────────────────────────────────────────────────── */}
        <section class="idp-card idp-facts" aria-label="Event">
          <Show
            when={props.event}
            fallback={
              <p class="idp-empty">No active event.</p>
            }
          >
            <For
              each={[
                { label: 'Event', value: props.event.event_id || DASH },
                { label: 'Hazard', value: props.event.disaster_type || DASH, cap: true },
                {
                  label: 'Severity',
                  value: isNumber(props.event.severity) ? `M ${decimal(props.event.severity, 1)}` : DASH,
                  strong: true,
                },
                {
                  label: 'Epicentre',
                  value: props.event.epicenter
                    ? fmt.coords(props.event.epicenter.latitude, props.event.epicenter.longitude)
                    : DASH,
                  tabular: true,
                },
                {
                  label: 'Impact radius',
                  value: isNumber(props.event.radius_km) ? fmt.distance(props.event.radius_km, 0) : DASH,
                  tabular: true,
                },
                { label: 'Depth', value: DASH, missing: true },
                { label: 'Aftershock risk', tone: riskTone(props.event.aftershock_risk),
                  value: props.event.aftershock_risk || DASH },
                { label: 'Tsunami risk', tone: props.event.tsunami_risk ? 'red' : null,
                  value: props.event.tsunami_risk ? 'Coastal warning' : 'None declared' },
              ]}
            >
              {(fact) => (
                <div class="idp-fact">
                  <span class="idp-label">{fact.label}</span>
                  <Show
                    when={fact.tone}
                    fallback={
                      <span
                        class="idp-fact__value"
                        classList={{
                          'is-capital': !!fact.cap,
                          'is-strong': !!fact.strong,
                          'is-tabular': !!fact.tabular,
                          'is-missing': !!fact.missing,
                        }}
                      >
                        {fact.value}
                      </span>
                    }
                  >
                    {(tone) => (
                      <span class={`idp-fact__value idp-tone idp-tone--${tone()}`}>{fact.value}</span>
                    )}
                  </Show>
                </div>
              )}
            </For>
            <p class="idp-facts__note">Depth is not provided by the supervisor.</p>
          </Show>
        </section>

        {/* ── Headline counters ───────────────────────────────────────────── */}
        <section class="idp-metrics" aria-label="Dispatch totals">
          <article class="idp-card idp-metric">
            <span class="idp-label">Devices located</span>
            <span class="idp-metric__value">{num(counts() ? counts().total : 0, '0')}</span>
            <Show when={counts() && counts().total > 0}>
              <span class="idp-split" aria-hidden="true">
                <For each={ZONE_ORDER}>
                  {(zone) => (
                    <span
                      class="idp-split__seg"
                      style={{
                        width: `${((zoneCount(zone)?.total || 0) / counts().total) * 100}%`,
                        background: ZONE_COLORS[zone],
                      }}
                    />
                  )}
                </For>
              </span>
            </Show>
            <span class="idp-metric__sub">CAMARA-located devices within the impact radius</span>
          </article>

          <article class="idp-card idp-metric">
            <span class="idp-label">Reachable</span>
            <span class="idp-metric__value">
              {num(counts() ? counts().reachable : 0, '0')}
              <small class="idp-metric__unit">
                {counts() && counts().reachableRate !== null
                  ? percent(counts().reachableRate, 0)
                  : DASH}
              </small>
            </span>
            <span class="idp-bar" aria-hidden="true">
              <span
                class="idp-bar__fill"
                style={{
                  width: `${counts() && counts().total ? (counts().reachable / counts().total) * 100 : 0}%`,
                  background: 'var(--gd-zone-green)',
                }}
              />
            </span>
            <span class="idp-metric__sub">Answering on data or SMS</span>
          </article>

          <article class="idp-card idp-metric">
            <span class="idp-label">Evacuation SMS sent</span>
            <span class="idp-metric__value">{num(counts() ? counts().sms : 0, '0')}</span>
            <span class="idp-bar" aria-hidden="true">
              <span
                class="idp-bar__fill"
                style={{
                  width: `${counts() && counts().total ? (counts().sms / counts().total) * 100 : 0}%`,
                  background: 'var(--gd-ink-2)',
                }}
              />
            </span>
            <span class="idp-metric__sub">Dispatched after the AI decision</span>
          </article>

          <article class="idp-card idp-metric">
            <span class="idp-label">Flagged for rescue</span>
            <span
              class="idp-metric__value"
              classList={{ 'is-red': !!(counts() && counts().rescue > 0) }}
            >
              {num(counts() ? counts().rescue : 0, '0')}
            </span>
            <span class="idp-bar" aria-hidden="true">
              <span
                class="idp-bar__fill"
                style={{
                  width: `${counts() && counts().total ? (counts().rescue / counts().total) * 100 : 0}%`,
                  background: 'var(--gd-red)',
                }}
              />
            </span>
            <span class="idp-metric__sub">Rescue flags can appear in any zone</span>
          </article>
        </section>

        {/* ── Zones — counts and the AI's report, one column each ─────────── */}
        <section class="idp-section" aria-label="Zones">
          <div class="idp-section__head">
            <h2 class="idp-section__title">Zones</h2>
            <span class="idp-section__meta">Reports update after each batch</span>
          </div>

          <div class="idp-zones">
            <For each={ZONE_ORDER}>
              {(zone) => (
                <article class="idp-card idp-zone" style={{ '--zone': ZONE_COLORS[zone] }}>
                  <div class="idp-zone__head">
                    <span class="idp-zone__word">
                      <span class="idp-zone__dot" aria-hidden="true" />
                      {ZONE_LABELS[zone]}
                    </span>
                    <Show when={props.event && isNumber(props.event.radius_km)}>
                      <span class="idp-zone__band">{fmt.band(zone, props.event.radius_km)}</span>
                    </Show>
                  </div>
                  <p class="idp-zone__meaning">{ZONE_MEANING[zone]}</p>

                  <dl class="idp-zone__stats">
                    <div class="idp-stat">
                      <dt class="idp-label">Located</dt>
                      <dd class="idp-stat__value">{num(zoneCount(zone)?.total, '0')}</dd>
                    </div>
                    <div class="idp-stat">
                      <dt class="idp-label">Reachable</dt>
                      <dd class="idp-stat__value">{num(zoneCount(zone)?.reachable, '0')}</dd>
                    </div>
                    {/* Shown wherever the supervisor actually flagged one.
                        The AI can escalate a zone and can flag an orange-zone
                        device, so gating this on `zone === 'red'` silently hid
                        real flags. A zone with none simply has one fewer
                        number rather than a placeholder. */}
                    <Show when={zone === 'red' || (zoneCount(zone)?.rescue || 0) > 0}>
                      <div class="idp-stat">
                        <dt class="idp-label">Rescue</dt>
                        <dd
                          class="idp-stat__value"
                          classList={{ 'is-red': (zoneCount(zone)?.rescue || 0) > 0 }}
                        >
                          {num(zoneCount(zone)?.rescue, '0')}
                        </dd>
                      </div>
                    </Show>
                  </dl>

                  <Show
                    when={props.narratives && props.narratives[zone]}
                    fallback={
                      <p class="idp-empty">Waiting for the first zone report.</p>
                    }
                  >
                    {(report) => (
                      <>
                        <p class="idp-zone__report">{report().text}</p>
                        <p class="idp-zone__stamp">Received {ago(report().receivedAt)}</p>
                      </>
                    )}
                  </Show>
                </article>
              )}
            </For>
          </div>
        </section>

        {/* ── Triage table ────────────────────────────────────────────────── */}
        <section class="idp-section" aria-label="Devices and decisions">
          <div class="idp-section__head">
            <h2 class="idp-section__title">Devices and decisions</h2>
            <span class="idp-section__meta">
              {num(sorted().length, '0')} of {num(allDevices().length, '0')} shown
            </span>
          </div>

          <div class="idp-card idp-table-card">
            <div class="idp-toolbar">
              <label class="idp-search">
                <span class="idp-search__icon" innerHTML={searchIcon} aria-hidden="true" />
                <input
                  type="search"
                  class="idp-search__input"
                  placeholder="Search a masked number, zone or shelter"
                  value={search()}
                  onInput={(e) => applySearch(e.currentTarget.value)}
                />
              </label>

              <div class="idp-segment" role="group" aria-label="Filter by zone">
                <For each={ZONE_FILTERS}>
                  {(item) => (
                    <button
                      type="button"
                      class="idp-segment__btn"
                      classList={{
                        'is-active': zoneFilter() === item.key,
                        [`is-${item.key}`]: true,
                      }}
                      aria-pressed={zoneFilter() === item.key}
                      onClick={() => applyZoneFilter(item.key)}
                    >
                      {item.label}
                      <span class="idp-segment__count">
                        {num(
                          item.key === 'all'
                            ? allDevices().length
                            : item.key === 'rescue'
                              ? (counts() ? counts().rescue : 0)
                              : (zoneCount(item.key)?.total ?? 0),
                          '0',
                        )}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="idp-table-scroll" ref={tableEl}>
              <table class="idp-table">
                <thead>
                  <tr>
                    <SortHeader label="Phone" col="phone" sortKey={sortKey()} dir={sortDir()} onSort={sortBy} />
                    <SortHeader label="Zone" col="zone" sortKey={sortKey()} dir={sortDir()} onSort={sortBy} />
                    <SortHeader label="Distance" col="distance" align="right" sortKey={sortKey()} dir={sortDir()} onSort={sortBy} />
                    <SortHeader label="Reachability" col="reach" sortKey={sortKey()} dir={sortDir()} onSort={sortBy} />
                    <th class="idp-th">AI action</th>
                    <th class="idp-th">Shelter</th>
                    <SortHeader label="Priority" col="priority" align="right" sortKey={sortKey()} dir={sortDir()} onSort={sortBy} />
                    <SortHeader label="Confidence" col="confidence" align="right" sortKey={sortKey()} dir={sortDir()} onSort={sortBy} />
                    <th class="idp-th">SMS</th>
                  </tr>
                </thead>
                <tbody>
                  <Show
                    when={pageDevices().length > 0}
                    fallback={
                      <tr>
                        <td class="idp-table__empty" colspan="9">
                          <Show
                            when={allDevices().length > 0}
                            fallback="No devices yet."
                          >
                            No device matches this filter.
                          </Show>
                        </td>
                      </tr>
                    }
                  >
                    <For each={pageDevices()}>
                      {(device) => (
                        <tr classList={{ 'is-rescue': !!device.rescue_flag }}>
                          <td class="idp-td idp-td--phone">
                            <button
                              type="button"
                              class="idp-link"
                              title="Open this device on the map"
                              onClick={() => openOnMap(device.phone)}
                            >
                              {maskPhone(device.phone)}
                            </button>
                          </td>
                          <td class="idp-td">
                            <span class="idp-zoneword" style={{ '--zone': ZONE_COLORS[device.zone] || 'var(--gd-ink-4)' }}>
                              <span class="idp-zoneword__dot" aria-hidden="true" />
                              {ZONE_LABELS[device.zone] || DASH}
                            </span>
                          </td>
                          <td class="idp-td idp-td--num">
                            {distanceOf(device) === null ? DASH : fmt.distance(distanceOf(device))}
                          </td>
                          <td class="idp-td">
                            <span
                              class="idp-state"
                              classList={{ 'is-down': !device.reachable }}
                            >
                              {reachabilityLabel(device)}
                            </span>
                          </td>
                          <td class="idp-td">
                            <span
                              class="idp-action"
                              classList={{
                                'is-rescue': device.rescue_flag,
                                'is-sms': device.sms_sent && !device.rescue_flag,
                                'is-none': !device.sms_sent && !device.rescue_flag,
                              }}
                            >
                              {ACTION_LABELS[deriveAction(device)]}
                            </span>
                          </td>
                          <td class="idp-td idp-td--shelter">{device.shelter_name || DASH}</td>
                          <td class="idp-td idp-td--num">
                            <Show when={priorityOf(device)} fallback={<span class="is-missing">{DASH}</span>}>
                              {(priority) => <span class="idp-priority">P{priority()}</span>}
                            </Show>
                          </td>
                          <td class="idp-td idp-td--num">
                            <Show
                              when={isNumber(device.confidence)}
                              fallback={<span class="is-missing">{DASH}</span>}
                            >
                              <span class="idp-confidence">
                                <span class="idp-confidence__track" aria-hidden="true">
                                  <span
                                    class="idp-confidence__fill"
                                    style={{ width: `${device.confidence * 100}%` }}
                                  />
                                </span>
                                {decimal(device.confidence, 2)}
                              </span>
                            </Show>
                          </td>
                          <td class="idp-td">
                            <Show
                              when={device.sms_sent}
                              fallback={<span class="is-missing">Not sent</span>}
                            >
                              <span class="idp-state">Sent</span>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            </div>

            <div class="idp-pager">
              <p class="idp-pager__range">
                <Show when={sorted().length > 0} fallback="No rows">
                  Rows {num(pageStart() + 1)}–{num(Math.min(pageStart() + PAGE_SIZE, sorted().length))} of{' '}
                  {num(sorted().length)}
                </Show>
              </p>
              <div class="idp-pager__controls">
                <button
                  type="button"
                  class="idp-ghost idp-ghost--sm"
                  disabled={safePage() <= 0}
                  onClick={() => goToPage(Math.max(0, safePage() - 1))}
                >
                  Previous
                </button>
                <span class="idp-pager__page">
                  Page {num(safePage() + 1)} of {num(pageCount())}
                </span>
                <button
                  type="button"
                  class="idp-ghost idp-ghost--sm"
                  disabled={safePage() >= pageCount() - 1}
                  onClick={() => goToPage(Math.min(pageCount() - 1, safePage() + 1))}
                >
                  Next
                </button>
              </div>
            </div>

            <p class="idp-note">Priority, confidence and shelter are demo-only.</p>
          </div>
        </section>

        {/* ── Shelters and telemetry ──────────────────────────────────────── */}
        <div class="idp-columns">
          <section class="idp-section" aria-label="Shelters">
            <div class="idp-section__head">
              <h2 class="idp-section__title">Shelters</h2>
              <span class="idp-section__meta">{num(shelters().length, '0')} listed</span>
            </div>

            <div class="idp-shelters">
              <For
                each={shelters()}
                fallback={<p class="idp-card idp-empty">No shelters are listed for this scenario.</p>}
              >
                {(shelter) => (
                  <article class="idp-card idp-shelter" classList={{ 'is-full': shelter.full }}>
                    <div class="idp-shelter__head">
                      <h3 class="idp-shelter__name">{shelter.name}</h3>
                      <span class="idp-shelter__word" classList={{ 'is-full': shelter.full }}>
                        {shelter.word}
                      </span>
                    </div>

                    <span class="idp-bar" aria-hidden="true">
                      <span
                        class="idp-bar__fill"
                        style={{
                          width: `${Math.min(100, (shelter.rate || 0) * 100)}%`,
                          background: shelter.full ? 'var(--gd-red)' : 'var(--gd-zone-green)',
                        }}
                      />
                    </span>

                    <dl class="idp-shelter__stats">
                      <div class="idp-stat">
                        <dt class="idp-label">Occupied</dt>
                        <dd class="idp-stat__value">
                          {num(shelter.occupied, DASH)} of {num(shelter.capacity, DASH)}
                          <small>{shelter.rate === null ? '' : ` · ${percent(shelter.rate, 0)}`}</small>
                        </dd>
                      </div>
                      <div class="idp-stat">
                        <dt class="idp-label">Routed by the AI</dt>
                        <dd class="idp-stat__value">{num(shelter.routed, '0')}</dd>
                      </div>
                      <div class="idp-stat">
                        <dt class="idp-label">Location</dt>
                        <dd class="idp-stat__value">
                          <Show when={shelter.anchor} fallback={<span class="is-missing">No coordinates</span>}>
                            {(anchor) => <>Near {anchor()}</>}
                          </Show>
                        </dd>
                      </div>
                    </dl>
                  </article>
                )}
              </For>
            </div>

            <p class="idp-note">
              Demo data only. Shelter occupancy and routing are not provided by the supervisor.
            </p>
          </section>

          <section class="idp-section" aria-label="Network">
            <div class="idp-section__head">
              <h2 class="idp-section__title">Network</h2>
              <span class="idp-section__meta">Nokia CAMARA</span>
            </div>

            <div class="idp-card idp-network">
              <dl class="idp-rows">
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">Reachable</dt>
                  <dd class="idp-stat__value">{num(counts() ? counts().reachable : 0, '0')}</dd>
                </div>
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">Unreachable</dt>
                  <dd class="idp-stat__value">{num(counts() ? counts().unreachable : 0, '0')}</dd>
                </div>
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">SMS dispatched</dt>
                  <dd class="idp-stat__value">{num(counts() ? counts().sms : 0, '0')}</dd>
                </div>
              </dl>

              <hr class="idp-rule" />

              <dl class="idp-rows">
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">Congestion insight</dt>
                  <dd class="idp-stat__value is-missing">{DASH}</dd>
                </div>
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">QoS on demand</dt>
                  <dd class="idp-stat__value is-missing">{DASH}</dd>
                </div>
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">SMS delivery rate</dt>
                  <dd class="idp-stat__value is-missing">{DASH}</dd>
                </div>
              </dl>

              <hr class="idp-rule" />

              <dl class="idp-rows">
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">Frame source</dt>
                  <dd class="idp-stat__value">
                    {SOURCE_LABEL[props.source === 'demo' ? 'demo' : 'supervisor']}
                  </dd>
                </div>
                <div class="idp-stat idp-stat--row">
                  <dt class="idp-label">Transport</dt>
                  <dd class="idp-stat__value">
                    {streamChip(props.phase, props.source === 'demo' ? 'demo' : 'supervisor').text}
                    <small>
                      {props.connection && props.connection.fps
                        ? ` · ${num(props.connection.fps)} frames/s`
                        : ''}
                    </small>
                  </dd>
                </div>
              </dl>

              <p class="idp-note">
                Congestion, QoS and delivery rate are not forwarded by the supervisor.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// A column header that can also be a sort control. Props are read inside the
// JSX, never destructured, so the arrow follows the live sort state.
function SortHeader(props) {
  const active = () => props.sortKey === props.col
  return (
    <th
      class="idp-th"
      classList={{ 'idp-th--right': props.align === 'right', 'is-active': active() }}
      aria-sort={active() ? (props.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" class="idp-th__btn" onClick={() => props.onSort(props.col)}>
        {props.label}
        <span class="idp-th__arrow" aria-hidden="true">
          {active() ? (props.dir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  )
}
