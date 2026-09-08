import { createSignal, onMount, onCleanup, Show, For } from 'solid-js'
import { ZONE_COLORS, ZONE_LABELS } from '../constants/zones'
import markIcon from '../assets/icons/geo-dispatch-mark.svg'
import pinIcon from '../assets/icons/location-pin.svg'
import chevronIcon from '../assets/icons/chevron-down-up.svg'
import searchIcon from '../assets/icons/search.svg'
import notificationsIcon from '../assets/icons/notifications.svg'
import './TopBar.css'

// Top bar — Figma 6:14 ("All Logo") + 60:2 ("Header controls").
//
// Every control here is a real control: the location pill is a dropdown wired
// to the operator-location hook, the search field is a live <input> over the
// device index, and the two auth buttons are honest about there being no auth
// service behind them (they call props.onAuthNote instead of faking a login).
//
// props is never destructured — in Solid that would read each value once, at
// setup, and freeze it.
export default function TopBar(props) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [searchFocused, setSearchFocused] = createSignal(false)

  let locationRef
  let searchRef

  const locationText = () => props.locationLabel || 'Set Location'
  const results = () => props.results || []
  const query = () => props.query || ''
  const errorCount = () => (typeof props.errorCount === 'number' ? props.errorCount : 0)

  // The results panel is only meaningful while the operator is actually in the
  // field and has typed something — otherwise it would cover the map for nothing.
  const showResults = () => searchFocused() && query().trim().length > 0

  const badgeText = () => (errorCount() > 99 ? '99+' : String(errorCount()))

  const notificationsLabel = () =>
    errorCount() > 0
      ? `Notifications, ${errorCount()} unresolved`
      : 'Notifications, none unresolved'

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
  })

  function useMyLocation() {
    setMenuOpen(false)
    props.onUseMyLocation?.()
  }

  function locateByIp() {
    setMenuOpen(false)
    props.onLocateByIp?.()
  }

  function selectRegion(name) {
    setMenuOpen(false)
    props.onSelectRegion?.(name)
  }

  function pickResult(phone) {
    setSearchFocused(false)
    props.onPickResult?.(phone)
  }

  return (
    <header class="gd-topbar" data-node-id="6:95">
      <div class="gd-logo" data-node-id="6:14">
        <span class="gd-logo__mark" data-node-id="6:18">
          <img src={markIcon} alt="" />
        </span>
        <span class="gd-logo__word" data-node-id="6:15">
          <span class="gd-logo__line">GEO</span>
          <span class="gd-logo__line">DISPATCH</span>
        </span>
      </div>

      <div class="gd-controls" data-node-id="60:2">
        {/* Location selector — 240x44 pill that opens the region menu. */}
        <div class="gd-location" ref={locationRef} data-node-id="60:3">
          <button
            type="button"
            class="gd-location__trigger"
            classList={{ 'is-open': menuOpen(), 'is-busy': !!props.locationBusy }}
            aria-haspopup="menu"
            aria-expanded={menuOpen()}
            onClick={() => setMenuOpen(!menuOpen())}
          >
            <span class="gd-location__pin">
              <img src={pinIcon} alt="" />
            </span>
            {/* The pill is a fixed 240px, so the longer region names ellipsise —
                the title keeps the whole name one hover away. */}
            <span class="gd-location__label" title={locationText()}>
              <Show when={props.locationBusy} fallback={locationText()}>
                Resolving location…
              </Show>
            </span>
            <span class="gd-location__chevron">
              <img src={chevronIcon} alt="" />
            </span>
          </button>

          <Show when={menuOpen()}>
            <div class="gd-menu" role="menu" aria-label="Set location">
              <button
                type="button"
                class="gd-menu__item"
                role="menuitem"
                onClick={useMyLocation}
              >
                Use my location
              </button>
              <button
                type="button"
                class="gd-menu__item"
                role="menuitem"
                onClick={locateByIp}
              >
                Locate by IP
              </button>
              <div class="gd-menu__divider" role="separator" />
              <For each={props.regions || []}>
                {(region) => (
                  <button
                    type="button"
                    class="gd-menu__item"
                    role="menuitem"
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
          <span class="gd-search__icon">
            <img src={searchIcon} alt="" />
          </span>
          <input
            type="search"
            class="gd-search__input"
            placeholder="Search zone, status, coordinates..."
            autocomplete="off"
            spellcheck={false}
            role="combobox"
            aria-expanded={showResults()}
            aria-controls="gd-search-results"
            aria-autocomplete="list"
            aria-label="Search devices"
            value={query()}
            onInput={(e) => props.onQueryInput?.(e.currentTarget.value)}
            onFocus={() => setSearchFocused(true)}
          />

          <Show when={showResults()}>
            <div
              class="gd-results"
              id="gd-search-results"
              role="listbox"
              aria-label="Search results"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Show
                when={results().length > 0}
                fallback={<p class="gd-results__empty">No device matches that search.</p>}
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
                          style={{ color: ZONE_COLORS[item.zone] }}
                        >
                          <span
                            class="gd-results__dot"
                            style={{ background: ZONE_COLORS[item.zone] }}
                          />
                          {ZONE_LABELS[item.zone]}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>

        <button
          type="button"
          class="gd-notifications"
          aria-label={notificationsLabel()}
          onClick={() => props.onNotifications?.()}
          data-node-id="62:2"
        >
          <img src={notificationsIcon} alt="" />
          <Show when={errorCount() > 0}>
            <span class="gd-notifications__badge">{badgeText()}</span>
          </Show>
        </button>

        <button
          type="button"
          class="gd-signin"
          onClick={() => props.onAuthNote?.('Sign in')}
          data-node-id="62:3"
        >
          Sign in
        </button>

        <button
          type="button"
          class="gd-getstarted"
          onClick={() => props.onAuthNote?.('Get Started')}
          data-node-id="62:4"
        >
          Get Started
        </button>
      </div>
    </header>
  )
}
