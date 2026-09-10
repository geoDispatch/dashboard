// Operator settings — the dialog behind the rail's Account and Settings tiles.
//
// Five tabs, one subject each. Every control on every tab changes something
// real the moment it is touched: there is no Save button because there is
// nothing waiting to be saved, and no preference here that the console then
// ignores. Where a control cannot do its job — an authorised PII view with no
// credential service behind it, a language with no translated strings — it
// says so on the control itself rather than pretending.
//
// SolidJS: props are never destructured, lists go through <For>, branches
// through <Show>.

import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'

import { BASEMAPS, basemapPreview, maxZoomFor, profileFor } from '../constants/basemaps'
import { prepareStyle } from '../lib/mapStyle'
import { fetchStyle, loadVectorEngine, snapshotStyle } from '../lib/vectorBasemap'
import { INTERFACE_SCALES, LANGUAGES, isWsUrl, useSettings } from '../lib/settings'
import { playAlert } from '../lib/audio'
import { SOURCE_DETAIL, SOURCE_LABEL, streamChip } from '../lib/streamState'
import { DASH, ago, coords, distance, dms, num, percent } from '../lib/format'

import accountIcon from '../assets/icons/nav-account.svg?raw'
import mapIcon from '../assets/icons/nav-map.svg?raw'
import bellIcon from '../assets/icons/notifications.svg?raw'
import streamIcon from '../assets/icons/panel-status.svg?raw'
import languageIcon from '../assets/icons/settings-language.svg?raw'
import closeIcon from '../assets/icons/settings-close.svg?raw'
import checkIcon from '../assets/icons/settings-check.svg?raw'
import lockIcon from '../assets/icons/settings-lock.svg?raw'
import dayIcon from '../assets/icons/theme-light.svg?raw'
import nightIcon from '../assets/icons/theme-dark.svg?raw'

import './SettingsModal.css'

const TABS = [
  { key: 'station', label: 'Station',    icon: accountIcon,  title: 'Station profile' },
  { key: 'basemap', label: 'Display',    icon: mapIcon,      title: 'Display' },
  { key: 'sound',   label: 'Alerts',     icon: bellIcon,     title: 'Sound and alerts' },
  { key: 'stream',  label: 'Stream',     icon: streamIcon,   title: 'Stream and network' },
  { key: 'locale',  label: 'Region',     icon: languageIcon, title: 'Region and privacy' },
]

const PROFILE_FIELDS = [
  { key: 'name',   label: 'Operator',     placeholder: 'Name as it appears on the shift roster' },
  { key: 'agency', label: 'Agency',       placeholder: 'Issuing authority' },
  { key: 'role',   label: 'Role',         placeholder: 'Post held on this console' },
  { key: 'sector', label: 'Jurisdiction', placeholder: 'Region and sector covered' },
  { key: 'badge',  label: 'Station badge', placeholder: '#MA-DISPATCH-00' },
]

// The three themes, in the order they are offered. The names are the whole
// label — what each one does is shown by its preview, not described.
const THEME_CHOICES = [
  { key: 'light',     name: 'Light' },
  { key: 'dark',      name: 'Dark' },
  { key: 'dark-blue', name: 'Dark blue' },
]
const NIGHT_CHOICES = THEME_CHOICES.filter((choice) => choice.key !== 'light')
const SCALE_CHOICES = INTERFACE_SCALES.map((scale) => ({
  key: scale,
  label: `${Math.round(scale * 100)}%`,
}))

// A sample point for the coordinate-format preview when no event has arrived.
const SAMPLE_POINT = { latitude: 31.0625, longitude: -8.4144 }

function Icon(props) {
  return <span class="set-icon" innerHTML={props.markup} aria-hidden="true" />
}

// A real switch, not a checkbox wearing a pill. Screen readers get the state
// from role/aria-checked; everyone else gets it from the knob.
//
// Named Toggle, NOT Switch. `<Switch>` is one of the element names the Solid
// compiler claims for its own control flow: a component of that name is
// silently replaced with solid-js's Switch at build time, which then looks for
// <Match> children, finds props it does not understand, and throws from inside
// the framework. The same trap is set for Show, For, Index, Match, Dynamic,
// Portal, Suspense and ErrorBoundary.
function Toggle(props) {
  return (
    <button
      type="button"
      role="switch"
      class="set-switch"
      classList={{ 'is-on': !!props.checked, 'is-locked': !!props.disabled }}
      aria-checked={props.checked ? 'true' : 'false'}
      aria-label={props.label}
      disabled={!!props.disabled}
      onClick={() => props.onChange && props.onChange(!props.checked)}
    >
      <span class="set-switch__knob" aria-hidden="true" />
    </button>
  )
}

function Segmented(props) {
  return (
    <div class="set-segment" role="group" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="set-segment__btn"
            classList={{ 'is-active': props.value === option.key }}
            aria-pressed={props.value === option.key}
            onClick={() => props.onChange && props.onChange(option.key)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

// The console in miniature: frame, rail, map ground, two cards and the zone
// rings. It carries its own data-theme, so it is drawn with THAT theme's real
// tokens whatever the page around it is in — a preview that cannot drift from
// the theme it shows. Decorative; the card's name is the accessible label.
function ThemePreview(props) {
  return (
    <span class="tp" data-theme={props.theme} aria-hidden="true">
      <span class="tp-bar">
        <span class="tp-logo" />
        <span class="tp-pill" />
        <span class="tp-search" />
        <span class="tp-cta" />
      </span>
      <span class="tp-rail">
        <span class="tp-tile is-on" />
        <span class="tp-tile" />
        <span class="tp-tile" />
      </span>
      <span class="tp-map">
        <span class="tp-ring is-green" />
        <span class="tp-ring is-orange" />
        <span class="tp-ring is-red" />
        <span class="tp-card">
          <span class="tp-line is-title" />
          <span class="tp-line" />
          <span class="tp-line is-short" />
        </span>
        <span class="tp-card">
          <span class="tp-line is-title" />
          <span class="tp-line" />
        </span>
      </span>
    </span>
  )
}

// Preview on top, radio and name underneath — GitHub's appearance picker.
// "Active" marks the theme on screen right now, which in Sync mode is not
// necessarily the one selected in that row.
function ThemeFace(props) {
  return (
    <>
      <ThemePreview theme={props.choice.key} />
      <span class="set-theme__foot">
        <span class="set-theme__radio" aria-hidden="true" />
        <span class="set-theme__name">{props.choice.name}</span>
        <Show when={props.active}>
          <span class="set-theme__badge">Active</span>
        </Show>
      </span>
    </>
  )
}

function ThemeCard(props) {
  return (
    <button
      type="button"
      class="set-theme"
      classList={{ 'is-selected': !!props.selected }}
      data-slot={props.slot}
      aria-pressed={!!props.selected}
      onClick={() => props.onPick && props.onPick()}
    >
      <ThemeFace choice={props.choice} active={props.active} />
    </button>
  )
}

// A basemap as it really is, over the Al Haouz epicentre. Vector basemaps are
// rendered — in the current theme, so the dark canvas shows graphite or navy
// exactly as the live map will — and read back as an image; satellite is one
// real imagery tile. If the vector engine cannot run in this browser, the
// live map falls back to raster tiles, and so does this preview: it shows the
// fallback's tile, which is then genuinely what the operator will get. If the
// engine runs but one render fails (a slow network, a timeout), the preview
// keeps the plain ground colour rather than show a raster tile the live map
// would not be drawing; the next time the tab opens, it tries again.
function BasemapPreview(props) {
  const [src, setSrc] = createSignal(null)
  const [renderer, setRenderer] = createSignal(props.basemap.vector ? 'vector' : 'raster')

  createEffect(() => {
    const basemap = props.basemap
    const profile = profileFor(basemap, props.theme)
    let live = true
    onCleanup(() => { live = false })

    if (!basemap.vector) {
      setRenderer('raster')
      setSrc(basemapPreview(basemap))
      return
    }

    setSrc(null)
    fetchStyle(basemap.vector.style)
      .then((style) => snapshotStyle(`${basemap.vector.style}|${profile}`, prepareStyle(style, profile)))
      .then((url) => {
        if (!live) return
        setRenderer('vector')
        setSrc(url)
      })
      .catch(() =>
        loadVectorEngine().then(
          () => {},   // the engine works; only this render failed
          () => {
            if (!live) return
            setRenderer('raster')
            setSrc(basemapPreview(basemap))
          },
        ),
      )
  })

  return (
    <span
      class="set-basemap__preview"
      data-basemap={props.basemap.key}
      data-renderer={renderer()}
      style={{ background: props.basemap.ground }}
    >
      <Show when={src()}>
        <img
          src={src()}
          alt=""
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
        />
      </Show>
      {props.children}
    </span>
  )
}

// label + explanation on the left, control on the right.
function Row(props) {
  return (
    <div class="set-row" classList={{ 'is-stacked': !!props.stacked }}>
      <div class="set-row__text">
        <span class="set-row__label">{props.label}</span>
        <Show when={props.hint}>
          <span class="set-row__hint">{props.hint}</span>
        </Show>
      </div>
      <div class="set-row__control">{props.children}</div>
    </div>
  )
}

function Card(props) {
  return (
    <section class="set-card">
      <Show when={props.title}>
        <header class="set-card__head">
          <h3 class="set-card__title">{props.title}</h3>
          <Show when={props.meta}>
            <span class="set-card__meta">{props.meta}</span>
          </Show>
        </header>
      </Show>
      {props.children}
      <Show when={props.note}>
        <p class="set-note">{props.note}</p>
      </Show>
    </section>
  )
}

export default function SettingsModal(props) {
  const store = useSettings()
  const settings = () => store.settings
  const syncTheme = () => settings().theme === 'system'

  const [tab, setTab] = createSignal(props.tab || 'station')
  const [draftUrl, setDraftUrl] = createSignal(store.settings.wsUrl)
  const [confirmEnd, setConfirmEnd] = createSignal(false)
  const [ping, setPing] = createSignal({ state: 'idle', ms: null })
  const [audioNote, setAudioNote] = createSignal(null)

  let dialogEl
  let firstTabEl

  // The rail opens the dialog on whichever tile was clicked, so a second click
  // on the other tile moves tabs rather than doing nothing.
  createEffect(() => {
    if (props.tab) setTab(props.tab)
  })

  onMount(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        props.onClose && props.onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))

    // Focus moves into the dialog so Escape and Tab belong to it immediately.
    queueMicrotask(() => firstTabEl && firstTabEl.focus())
  })

  const activeTitle = () => (TABS.find((t) => t.key === tab()) || TABS[0]).title

  // ── sound ─────────────────────────────────────────────────────────────
  async function test(voice) {
    // This click IS the gesture the autoplay policy is waiting for. playAlert
    // resumes the context itself, so pressing Test is also what grants every
    // later stream-driven alert permission to be heard.
    const played = await playAlert(voice, settings().volume)
    if (played) return setAudioNote(null)
    setAudioNote(
      settings().volume === 0
        ? 'Volume is at zero.'
        : 'This browser is not letting the console play audio.',
    )
  }

  // ── stream ────────────────────────────────────────────────────────────
  const urlChanged = () => draftUrl().trim() !== settings().wsUrl
  const urlValid = () => isWsUrl(draftUrl())

  function applyUrl() {
    if (!urlValid() || !urlChanged()) return
    const next = draftUrl().trim()
    store.set('wsUrl', next)
    props.onApplyWsUrl && props.onApplyWsUrl(next)
  }

  async function runPing() {
    setPing({ state: 'busy', ms: null })
    const started = performance.now()
    const ok = props.onPing ? await props.onPing() : false
    setPing({ state: ok ? 'ok' : 'fail', ms: Math.round(performance.now() - started) })
  }

  const connection = () => props.connection || {}
  const isDemo = () => props.source === 'demo'

  // ── localisation preview ──────────────────────────────────────────────
  const samplePoint = () => (props.event && props.event.epicenter) || SAMPLE_POINT
  const sampleRadius = () =>
    props.event && typeof props.event.radius_km === 'number' ? props.event.radius_km : 50

  return (
    <div
      class="set-scrim"
      onClick={() => props.onClose && props.onClose()}
    >
      <div
        class="set-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Operator settings"
        ref={dialogEl}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Tab rail ──────────────────────────────────────────────────── */}
        <nav class="set-rail" aria-label="Settings sections">
          <p class="set-rail__title">Settings</p>
          <ul class="set-rail__list">
            <For each={TABS}>
              {(item, index) => (
                <li>
                  <button
                    type="button"
                    class="set-rail__btn"
                    classList={{ 'is-active': tab() === item.key }}
                    aria-current={tab() === item.key ? 'page' : undefined}
                    ref={(el) => { if (index() === 0) firstTabEl = el }}
                    onClick={() => setTab(item.key)}
                  >
                    <Icon markup={item.icon} />
                    {item.label}
                  </button>
                </li>
              )}
            </For>
          </ul>

          <p class="set-rail__foot">
            <Show
              when={store.canPersist()}
              fallback="Storage is blocked. Changes last for this session only."
            >
              Saved in this browser.
            </Show>
          </p>
        </nav>

        {/* ── Panel ─────────────────────────────────────────────────────── */}
        <div class="set-panel">
          <header class="set-panel__head">
            <h2 class="set-panel__title">{activeTitle()}</h2>
            <button
              type="button"
              class="set-close"
              aria-label="Close settings"
              onClick={() => props.onClose && props.onClose()}
            >
              <Icon markup={closeIcon} />
            </button>
          </header>

          <div class="set-panel__body">

            {/* ── Station ────────────────────────────────────────────────── */}
            <Show when={tab() === 'station'}>
              <Card
                title="Station identity"
                note="Stored only in this browser. Not verified by an agency account service."
              >
                <div class="set-fields">
                  <For each={PROFILE_FIELDS}>
                    {(field) => (
                      <label class="set-field">
                        <span class="set-field__label">{field.label}</span>
                        <input
                          type="text"
                          class="set-field__input"
                          value={settings().operator[field.key]}
                          placeholder={field.placeholder}
                          onInput={(e) => store.setOperator(field.key, e.currentTarget.value)}
                        />
                      </label>
                    )}
                  </For>
                </div>
              </Card>

              <Card
                title="End of shift"
                note="Ends the shift and resets this station's profile and settings."
              >
                <Row
                  label="Clear this station"
                  hint="Resets the profile and all console settings."
                >
                  <Show
                    when={confirmEnd()}
                    fallback={
                      <button
                        type="button"
                        class="set-btn set-btn--danger"
                        onClick={() => setConfirmEnd(true)}
                      >
                        End shift
                      </button>
                    }
                  >
                    <div class="set-confirm">
                      <button
                        type="button"
                        class="set-btn set-btn--danger"
                        onClick={() => {
                          store.reset()
                          setDraftUrl(store.settings.wsUrl)
                          setConfirmEnd(false)
                          props.onEndShift && props.onEndShift()
                        }}
                      >
                        Clear station
                      </button>
                      <button
                        type="button"
                        class="set-btn"
                        onClick={() => setConfirmEnd(false)}
                      >
                        Keep
                      </button>
                    </div>
                  </Show>
                </Row>
              </Card>
            </Show>

            {/* ── Display ────────────────────────────────────────────────── */}
            <Show when={tab() === 'basemap'}>
              <Card
                title="Interface size"
                note="75% is the default. Browser zoom remains available."
              >
                <Row
                  label="Interface scale"
                  hint="Saved in this browser and applied immediately."
                >
                  <Segmented
                    label="Interface scale"
                    value={settings().interfaceScale}
                    options={SCALE_CHOICES}
                    onChange={(scale) => store.set('interfaceScale', scale)}
                  />
                </Row>
              </Card>

              <Card
                title="Appearance"
                note="Choose a theme. Map markers and zone colours stay unchanged."
              >
                <Row
                  label="Theme mode"
                  hint={
                    syncTheme()
                      ? "Follows your computer's light and dark modes."
                      : 'One theme, kept until you change it here.'
                  }
                >
                  <Segmented
                    label="Theme mode"
                    value={syncTheme() ? 'system' : 'single'}
                    options={[
                      { key: 'single', label: 'Single theme' },
                      { key: 'system', label: 'Sync with system' },
                    ]}
                    onChange={(key) =>
                      props.onSetTheme &&
                      // Leaving Sync keeps whatever is on screen, so the
                      // switch itself never changes a colour.
                      props.onSetTheme(key === 'system' ? 'system' : props.theme || 'light')
                    }
                  />
                </Row>

                <Show
                  when={syncTheme()}
                  fallback={
                    <div class="set-themes" role="group" aria-label="Theme">
                      <For each={THEME_CHOICES}>
                        {(choice) => (
                          <ThemeCard
                            choice={choice}
                            selected={settings().theme === choice.key}
                            onPick={() => props.onSetTheme && props.onSetTheme(choice.key)}
                          />
                        )}
                      </For>
                    </div>
                  }
                >
                  <div class="set-themes is-sync">
                    <span class="set-themes__group" data-slot="day-label">
                      <Icon markup={dayIcon} /> Day theme
                    </span>
                    {/* Light is the only day theme, so it is shown selected
                        and cannot be un-picked — a card, not a button. */}
                    <div class="set-theme is-selected is-static" data-slot="day">
                      <ThemeFace choice={THEME_CHOICES[0]} active={!props.systemDark} />
                    </div>

                    <span class="set-themes__group" data-slot="night-label">
                      <Icon markup={nightIcon} /> Night theme
                    </span>
                    <For each={NIGHT_CHOICES}>
                      {(choice, i) => (
                        <ThemeCard
                          choice={choice}
                          slot={i() === 0 ? 'night-a' : 'night-b'}
                          selected={settings().nightTheme === choice.key}
                          active={!!props.systemDark && settings().nightTheme === choice.key}
                          onPick={() => props.onSetNightTheme && props.onSetNightTheme(choice.key)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Card>

              <Card
                title="Map ground"
                meta="Updates immediately"
                note="Choose the map style. Markers, zones and the current view stay unchanged."
              >
                <div class="set-basemaps">
                  <For each={BASEMAPS}>
                    {(basemap) => (
                      <button
                        type="button"
                        class="set-basemap"
                        classList={{ 'is-active': settings().basemap === basemap.key }}
                        aria-pressed={settings().basemap === basemap.key}
                        onClick={() => store.set('basemap', basemap.key)}
                      >
                        <BasemapPreview basemap={basemap} theme={props.theme}>
                          <Show when={settings().basemap === basemap.key}>
                            <span class="set-basemap__tick" aria-hidden="true">
                              <Icon markup={checkIcon} />
                            </span>
                          </Show>
                        </BasemapPreview>
                        <span class="set-basemap__name">{basemap.name}</span>
                        <span class="set-basemap__blurb">{basemap.blurb}</span>
                        <span class="set-basemap__meta">
                          {basemap.vector ? 'Vector map' : 'Imagery tiles'} · zooms to{' '}
                          {maxZoomFor(basemap, basemap.vector ? 'vector' : 'raster')}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Card>
            </Show>

            {/* ── Sound ──────────────────────────────────────────────────── */}
            <Show when={tab() === 'sound'}>
              <Card
                title="Dispatch alerts"
                note="Use Test once to enable browser audio."
              >
                <Row
                  label="Rescue chime"
                  hint="Plays once when a P1 rescue is first flagged."
                >
                  <div class="set-inline">
                    <button type="button" class="set-btn" onClick={() => test('rescue')}>
                      Test
                    </button>
                    <Toggle
                      label="Rescue chime"
                      checked={settings().rescueChime}
                      onChange={(v) => store.set('rescueChime', v)}
                    />
                  </div>
                </Row>

                <Row
                  label="Pipeline alarm"
                  hint="Plays once when a fatal pipeline error stops dispatch."
                >
                  <div class="set-inline">
                    <button type="button" class="set-btn" onClick={() => test('fatal')}>
                      Test
                    </button>
                    <Toggle
                      label="Pipeline alarm"
                      checked={settings().fatalAlarm}
                      onChange={(v) => store.set('fatalAlarm', v)}
                    />
                  </div>
                </Row>

                <Row label="Volume" hint="Applies to both tones.">
                  <div class="set-inline">
                    <input
                      type="range"
                      class="set-range"
                      min="0"
                      max="100"
                      step="5"
                      aria-label="Alert volume"
                      value={Math.round(settings().volume * 100)}
                      onInput={(e) => store.set('volume', Number(e.currentTarget.value) / 100)}
                    />
                    <span class="set-inline__value">
                      {percent(settings().volume, 0)}
                    </span>
                  </div>
                </Row>

                <Show when={audioNote()}>
                  <p class="set-warn" role="status">{audioNote()}</p>
                </Show>
              </Card>
            </Show>

            {/* ── Stream ─────────────────────────────────────────────────── */}
            <Show when={tab() === 'stream'}>
              <Card
                title="Supervisor endpoint"
                note="Changing the WebSocket URL reconnects and clears the board. New data appears with the next frame."
              >
                <Row
                  label="WebSocket URL"
                  hint="Must start with ws:// or wss://."
                  stacked
                >
                  <div class="set-url">
                    <input
                      type="text"
                      class="set-field__input"
                      classList={{ 'is-invalid': draftUrl().length > 0 && !urlValid() }}
                      value={draftUrl()}
                      spellcheck={false}
                      autocomplete="off"
                      aria-label="Supervisor WebSocket URL"
                      onInput={(e) => setDraftUrl(e.currentTarget.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyUrl() }}
                    />
                    <button
                      type="button"
                      class="set-btn set-btn--primary"
                      disabled={!urlChanged() || !urlValid()}
                      onClick={applyUrl}
                    >
                      Apply
                    </button>
                  </div>
                  <Show when={draftUrl().length > 0 && !urlValid()}>
                    <p class="set-warn">
                      A supervisor address has to start with ws:// or wss://.
                    </p>
                  </Show>
                </Row>

                <Row label="Reachability" hint="One GET against the supervisor's /health route.">
                  <div class="set-inline">
                    <span
                      class="set-inline__value"
                      classList={{
                        'is-good': ping().state === 'ok',
                        'is-bad': ping().state === 'fail',
                      }}
                    >
                      <Show when={ping().state !== 'idle'} fallback="Not checked">
                        <Show when={ping().state !== 'busy'} fallback="Checking…">
                          {ping().state === 'ok' ? 'Answered' : 'No answer'} · {num(ping().ms)} ms
                        </Show>
                      </Show>
                    </span>
                    <button
                      type="button"
                      class="set-btn"
                      disabled={ping().state === 'busy'}
                      onClick={runPing}
                    >
                      Ping
                    </button>
                  </div>
                </Row>
              </Card>

              <Card
                title="Frame source"
                note="Changing the frame source clears the board."
              >
                <Row
                  label="Where frames come from"
                  hint={SOURCE_DETAIL[isDemo() ? 'demo' : 'supervisor']}
                  stacked
                >
                  <Segmented
                    label="Frame source"
                    value={isDemo() ? 'demo' : 'supervisor'}
                    options={[
                      { key: 'supervisor', label: 'Connected supervisor' },
                      { key: 'demo', label: 'Bundled demo' },
                    ]}
                    onChange={(key) => {
                      if (key === 'demo') props.onUseDemo && props.onUseDemo()
                      else props.onUseSupervisor && props.onUseSupervisor()
                    }}
                  />
                </Row>
              </Card>

              <Card title="Live readout">
                <dl class="set-readout">
                  <div class="set-readout__row">
                    <dt>Source</dt>
                    <dd>{SOURCE_LABEL[isDemo() ? 'demo' : 'supervisor']}</dd>
                  </div>
                  <div class="set-readout__row">
                    <dt>Transport</dt>
                    <dd>{streamChip(props.phase, isDemo() ? 'demo' : 'supervisor').text}</dd>
                  </div>
                  <div class="set-readout__row">
                    <dt>Frames</dt>
                    <dd>
                      {num(connection().frames, '0')}
                      <small> received · {num(connection().fps, '0')}/s now</small>
                    </dd>
                  </div>
                  <div class="set-readout__row">
                    <dt>Last frame</dt>
                    <dd>{ago(connection().lastFrameAt)}</dd>
                  </div>
                  <div class="set-readout__row">
                    <dt>Console link</dt>
                    <dd>
                      {props.netLabel || DASH}
                      <Show when={props.netQuality}>
                        <small> · {props.netQuality}</small>
                      </Show>
                    </dd>
                  </div>
                </dl>
                <p class="set-note">
                  Console link describes this browser's connection. Transport describes the
                  WebSocket. The upstream CAMARA source cannot be verified here.
                </p>
              </Card>
            </Show>

            {/* ── Region and privacy ─────────────────────────────────────── */}
            <Show when={tab() === 'locale'}>
              <Card
                title="Language"
                note="Changes the document language only. Interface translations are not available yet."
              >
                <div class="set-langs">
                  <For each={LANGUAGES}>
                    {(language) => (
                      <button
                        type="button"
                        class="set-lang"
                        classList={{ 'is-active': settings().language === language.key }}
                        aria-pressed={settings().language === language.key}
                        onClick={() => store.set('language', language.key)}
                      >
                        <span class="set-lang__native">{language.native}</span>
                        <span class="set-lang__label">
                          {language.label}
                          <Show when={language.rtl}>
                            <span class="set-tag">RTL</span>
                          </Show>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={settings().language === 'ar'}>
                  <p class="set-warn">Right-to-left layout is not available yet.</p>
                </Show>
              </Card>

              <Card title="Casualty data privacy">
                <Row
                  label="Masked phone numbers"
                  hint="Phone numbers are always masked."
                >
                  <Toggle label="Masked phone numbers" checked disabled />
                </Row>

                <div class="set-gate">
                  <span class="set-gate__icon" innerHTML={lockIcon} aria-hidden="true" />
                  <div class="set-gate__text">
                    <p class="set-gate__title">Full phone numbers</p>
                    <p class="set-gate__body">
                      Unavailable until an authorised credential service is connected.
                    </p>
                  </div>
                </div>
              </Card>

              <Card
                title="Units and coordinates"
                note="Miles are converted for display only."
              >
                <Row
                  label="Coordinate format"
                  hint={
                    settings().coordFormat === 'dms'
                      ? dms(samplePoint().latitude, samplePoint().longitude)
                      : coords(samplePoint().latitude, samplePoint().longitude)
                  }
                >
                  <Segmented
                    label="Coordinate format"
                    value={settings().coordFormat}
                    options={[
                      { key: 'decimal', label: 'Decimal' },
                      { key: 'dms', label: 'D° M′ S″' },
                    ]}
                    onChange={(key) => store.set('coordFormat', key)}
                  />
                </Row>

                <Row
                  label="Distance"
                  hint={`Impact radius reads ${distance(sampleRadius(), { units: settings().units, places: 0 })}`}
                >
                  <Segmented
                    label="Distance units"
                    value={settings().units}
                    options={[
                      { key: 'km', label: 'Kilometres' },
                      { key: 'mi', label: 'Miles' },
                    ]}
                    onChange={(key) => store.set('units', key)}
                  />
                </Row>
              </Card>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
