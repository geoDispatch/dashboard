import { createSignal, onMount, onCleanup, Show, For } from 'solid-js'
import { ZONE_COLORS, ZONE_LABELS, ZONE_TEXT } from '../constants/zones'
import { MIN_QUERY_LENGTH, parseCoordinates, searchPlaces } from '../lib/geocode'
import { useT } from '../lib/i18n'
// Inlined (?raw) rather than loaded through <img>: the lockup is drawn in
// currentColor with real knockouts, so it takes the header's ink — black on the
// light bar, white on the graphite and #001DF3 dark bars — from one file.
import logoLockup from '../assets/icons/geo-dispatch-logo.svg?raw'
// Icons are inlined with Vite's ?raw suffix rather than loaded through <img>.
// An SVG behind <img src> is an isolated document, so its stroke="currentColor"
// resolves to that document's own black — inlining is what lets `color` cascade
// in and gives us hover / open / disabled states for free.
import pinIcon from '../assets/icons/location-pin.svg?raw'
import chevronIcon from '../assets/icons/chevron-down-up.svg?raw'
import searchIcon from '../assets/icons/search.svg?raw'
import accountIcon from '../assets/icons/nav-account.svg?raw'
import notificationsIcon from '../assets/icons/notifications.svg?raw'
import './TopBar.css'

// Top bar — Figma 6:14 ("All Logo") + 60:2 ("Header controls").
//
// Every control here is a real control: the location pill is a dropdown wired
// to the operator-location hook, the search field is a live <input> over the
// device index, and the right-hand control names the station this console is
// signed in as.
//
// The separate entry screen is deliberately a frontend-only gate until a real
// credential service exists. This corner answers "whose local station profile
// is this" and opens its settings; it does not claim an authenticated identity.
//
// props is never destructured — in Solid that would read each value once, at
// setup, and freeze it.
export default function TopBar(props) {
  const t = useT()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [searchFocused, setSearchFocused] = createSignal(false)

  // Place search inside the location menu: "new y" → New York. Debounced,
  // and a newer query aborts the one before it, so a slow answer for "new"
  // can never replace the answer for "new york".
  const [placeQuery, setPlaceQuery] = createSignal('')
  const [places, setPlaces] = createSignal([])
  const [placeState, setPlaceState] = createSignal('idle')   // idle | searching | done | error
  const [placeError, setPlaceError] = createSignal(null)
  let placeTimer = null
  let placeAbort = null
  let placeInput

  let locationRef
  let searchRef

  const locationText = () => props.locationLabel || t('topbar.setLocation')
  const results = () => props.results || []
  const query = () => props.query || ''
  const errorCount = () => (typeof props.errorCount === 'number' ? props.errorCount : 0)

  // The results panel is only meaningful while the operator is actually in the
  // field and has typed something — otherwise it would cover the map for nothing.
  const showResults = () => searchFocused() && query().trim().length > 0

  const badgeText = () => (errorCount() > 99 ? '99+' : String(errorCount()))

  // An operator who clears the name field should still get a labelled control,
  // not an empty one.
  const operatorName = () => {
    const name = props.operator && props.operator.name
    return name && name.trim() ? name : t('topbar.unnamedStation')
  }

  const notificationsLabel = () =>
    errorCount() > 0
      ? t('topbar.notifCount', errorCount())
      : t('topbar.notifNone')

  // geocode.js explains a failed search in English. Other languages get one
  // translated sentence, with the English detail kept as its tooltip.
  const placeErrorText = () => (t.lang() === 'en' ? placeError() : t('topbar.placeError'))

  function closeAll() {
    setMenuOpen(false)
    setSearchFocused(false)
  }

  // Outside click / Escape. pointerdown (not click) so the panel is already
  // gone by the time a click lands on whatever is underneath it.
  function handlePointerDown(event) {
    if (locationRef && !locationRef.contains(event.target)) setMenuOpen(false)
    if (searchRef && !searchRef.contains(event.target)) setSearchFocused(false)
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') closeAll()
  }

  onMount(() => {
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener('pointerdown', handlePointerDown, true)
    document.removeEventListener('keydown', handleKeyDown)
    clearTimeout(placeTimer)
    placeAbort?.abort()
  })

  function toggleMenu() {
    const open = !menuOpen()
    setMenuOpen(open)
    if (open) requestAnimationFrame(() => placeInput?.focus())
  }

  function useMyLocation() {
    setMenuOpen(false)
    props.onUseMyLocation?.()
  }

  function selectRegion(name) {
    setMenuOpen(false)
    props.onSelectRegion?.(name)
  }

  function onPlaceInput(value) {
    setPlaceQuery(value)
    clearTimeout(placeTimer)
    placeAbort?.abort()
    const text = value.trim()
    if (!text || (text.length < MIN_QUERY_LENGTH && !parseCoordinates(text))) {
      setPlaces([])
      setPlaceState('idle')
      return
    }
    setPlaceState('searching')
    // Coordinates answer at once; names wait for the operator to pause.
    placeTimer = setTimeout(runPlaceSearch, parseCoordinates(text) ? 0 : 250)
  }

  async function runPlaceSearch() {
    const ctrl = new AbortController()
    placeAbort = ctrl
    try {
      const { places: found, error } = await searchPlaces(placeQuery(), { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setPlaces(found)
      setPlaceError(error)
      setPlaceState(error ? 'error' : 'done')
    } catch {
      // Aborted by a newer query, which will answer instead.
    }
  }

  function pickPlace(place) {
    setMenuOpen(false)
    setPlaceQuery('')
    setPlaces([])
    setPlaceState('idle')
    props.onSelectPlace?.(place)
  }

  function onPlaceKey(event) {
    if (event.key === 'Enter' && places().length) {
      event.preventDefault()
      pickPlace(places()[0])
    }
  }

  function pickResult(phone) {
    setSearchFocused(false)
    props.onPickResult?.(phone)
  }

  return (
    <header class="gd-topbar" data-node-id="6:95">
      {/* The whole lockup as one exported asset, not a mark plus live text.
          The wordmark is set in Test Die Grotesk, which is a licensed test
          font we cannot ship — rebuilding it in DM Sans gave the wrong
          letterforms and spacing. Figma's SVG export carries the glyphs as
          outlines, so it matches the design exactly and depends on no font. */}
      <div class="gd-logo" data-node-id="6:14">
        <span class="gd-logo__lockup" role="img" aria-label="GeoDispatch" innerHTML={logoLockup} />
      </div>

      <div class="gd-controls" data-node-id="60:2">
        {/* Location selector — 240x44 pill that opens the region menu. */}
        <div class="gd-location" ref={locationRef} data-node-id="60:3">
          <button
            type="button"
            class="gd-location__trigger"
            classList={{ 'is-open': menuOpen(), 'is-busy': !!props.locationBusy }}
            aria-haspopup="dialog"
            aria-expanded={menuOpen()}
            onClick={toggleMenu}
          >
            <span class="gd-location__pin" aria-hidden="true" innerHTML={pinIcon} />
            {/* The pill is a fixed 240px, so the longer region names ellipsise —
                the title keeps the whole name one hover away. */}
            <span class="gd-location__label" title={locationText()}>
              <Show when={props.locationBusy} fallback={locationText()}>
                {t('topbar.resolving')}
              </Show>
            </span>
            <span class="gd-location__chevron" aria-hidden="true" innerHTML={chevronIcon} />
          </button>

          <Show when={menuOpen()}>
            <div class="gd-menu" role="dialog" aria-label={t('topbar.setLocationMenu')}>
              <div class="gd-menu__search">
                <span class="gd-menu__search-icon" aria-hidden="true" innerHTML={searchIcon} />
                <input
                  ref={placeInput}
                  type="search"
                  class="gd-menu__input"
                  placeholder={t('topbar.placePlaceholder')}
                  autocomplete="off"
                  spellcheck={false}
                  aria-label={t('topbar.placeLabel')}
                  value={placeQuery()}
                  onInput={(e) => onPlaceInput(e.currentTarget.value)}
                  onKeyDown={onPlaceKey}
                />
              </div>

              <Show when={placeQuery().trim()}>
                <div class="gd-menu__places" role="listbox" aria-label={t('topbar.places')}>
                  <Show when={placeState() === 'searching' && !places().length}>
                    <p class="gd-menu__hint">{t('topbar.searching')}</p>
                  </Show>
                  <Show when={placeState() === 'error'}>
                    <p class="gd-menu__hint" title={placeError()}>{placeErrorText()}</p>
                  </Show>
                  <Show when={placeState() === 'done' && !places().length}>
                    <p class="gd-menu__hint">{t('topbar.noPlace')}</p>
                  </Show>
                  <For each={places()}>
                    {(place) => (
                      <button
                        type="button"
                        class="gd-menu__place"
                        role="option"
                        aria-selected="false"
                        onClick={() => pickPlace(place)}
                      >
                        <span class="gd-menu__place-name">{place.name}</span>
                        <span class="gd-menu__place-sub">
                          {place.kind === 'coordinates' ? t('topbar.coordinates') : place.label}
                        </span>
                      </button>
                    )}
                  </For>
                  <p class="gd-menu__credit">{t('topbar.placesCredit')}</p>
                </div>
              </Show>

              <div class="gd-menu__divider" role="separator" />
              <button
                type="button"
                class="gd-menu__item"
                onClick={useMyLocation}
              >
                {t('topbar.useMyLocation')}
              </button>
              <div class="gd-menu__divider" role="separator" />
              <For each={props.regions || []}>
                {(region) => (
                  <button
                    type="button"
                    class="gd-menu__item"
                    aria-current={region.name === props.locationLabel ? 'true' : undefined}
                    onClick={() => selectRegion(region.name)}
                  >
                    {region.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Search — filters the device index by masked phone, zone, locality
            or coordinates. The parent owns the filtering; this owns the field. */}
        <div class="gd-search" ref={searchRef} data-node-id="60:4">
          <span class="gd-search__icon" aria-hidden="true" innerHTML={searchIcon} />
          <input
            type="search"
            class="gd-search__input"
            placeholder={t('topbar.searchPlaceholder')}
            autocomplete="off"
            spellcheck={false}
            role="combobox"
            aria-expanded={showResults()}
            aria-controls="gd-search-results"
            aria-autocomplete="list"
            aria-label={t('topbar.searchLabel')}
            value={query()}
            onInput={(e) => props.onQueryInput?.(e.currentTarget.value)}
            onFocus={() => setSearchFocused(true)}
          />

          <Show when={showResults()}>
            <div
              class="gd-results"
              id="gd-search-results"
              role="listbox"
              aria-label={t('topbar.searchResults')}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Show
                when={results().length > 0}
                fallback={<p class="gd-results__empty">{t('topbar.noMatch')}</p>}
              >
                <For each={results()}>
                  {(item) => (
                    <button
                      type="button"
                      class="gd-results__item"
                      role="option"
                      aria-selected="false"
                      onClick={() => pickResult(item.phone)}
                    >
                      <span class="gd-results__label">{item.label}</span>
                      <Show when={item.sub}>
                        <span class="gd-results__sub">{item.sub}</span>
                      </Show>
                      {/* A zone is never colour alone — the word rides with the dot. */}
                      <Show when={ZONE_LABELS[item.zone]}>
                        <span
                          class="gd-results__zone"
                          style={{ color: ZONE_TEXT[item.zone] }}
                        >
                          <span
                            class="gd-results__dot"
                            style={{ background: ZONE_COLORS[item.zone] }}
                          />
                          {t(`zone.${item.zone}`)}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>

        {/* Launch incident.
            Every other control on this bar reads. This one writes: it opens
            the dialog that POSTs a sensor reading to the supervisor, which is
            the only request the console ever sends. It is styled as the one
            filled button on the bar for exactly that reason. */}
        <button
          type="button"
          class="gd-launch"
          onClick={() => props.onLaunchIncident?.()}
        >
          <span class="gd-launch__plus" aria-hidden="true">+</span>
          <span class="gd-launch__label">{t('topbar.launch')}</span>
        </button>

        {/* Stop ⇄ Run. While a browser simulation is on the board this stops
            it; afterwards it plays the last one again, with no launcher to
            open. Beside Launch, and on the bar so it is there in every view. */}
        <Show
          when={props.simulating}
          fallback={
            <Show when={props.canRunSimulation}>
              <button
                type="button"
                class="gd-stop-sim gd-stop-sim--run"
                title={props.runSimulationTitle || t('topbar.runSimTitle')}
                onClick={() => props.onRunSimulation?.()}
              >
                <span class="gd-run-sim__icon" aria-hidden="true" />
                <span class="gd-stop-sim__label">{t('topbar.runSim')}</span>
              </button>
            </Show>
          }
        >
          <button
            type="button"
            class="gd-stop-sim"
            title={t('topbar.stopSimTitle')}
            onClick={() => props.onStopSimulation?.()}
          >
            <span class="gd-stop-sim__icon" aria-hidden="true" />
            <span class="gd-stop-sim__label">{t('topbar.stopSim')}</span>
          </button>
        </Show>

        {/* The bell used to open a popover that listed error codes. It now
            opens the telemetry drawer, which lists the same codes plus the
            reachability split and the recent warnings — one surface for the
            fault picture instead of two that disagree about how much of it
            to show. */}
        <button
          type="button"
          class="gd-notifications"
          classList={{ 'is-open': !!props.telemetryOpen }}
          aria-label={notificationsLabel()}
          aria-expanded={!!props.telemetryOpen}
          aria-haspopup="dialog"
          onClick={() => props.onOpenTelemetry?.()}
        >
          <span class="gd-notifications__icon" aria-hidden="true" innerHTML={notificationsIcon} />
          <Show when={errorCount() > 0}>
            <span class="gd-notifications__badge">{badgeText()}</span>
          </Show>
        </button>

        <button
          type="button"
          class="gd-account"
          aria-label={t('topbar.accountLabel', operatorName())}
          title={t('topbar.accountTitle')}
          onClick={() => props.onOpenAccount?.()}
        >
          <span class="gd-account__icon" innerHTML={accountIcon} aria-hidden="true" />
          <span class="gd-account__text">
            <span class="gd-account__name">{operatorName()}</span>
            <Show when={props.operator && props.operator.badge}>
              {(badge) => <span class="gd-account__badge">{badge()}</span>}
            </Show>
          </span>
        </button>
      </div>
    </header>
  )
}
