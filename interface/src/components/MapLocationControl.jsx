import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'

import { useT } from '../lib/i18n'
import locateIcon from '../assets/icons/locate.svg?raw'
import mapIcon from '../assets/icons/nav-map.svg?raw'
import './MapLocationControl.css'

export default function MapLocationControl(props) {
  const t = useT()
  const [open, setOpen] = createSignal(false)

  let root
  let trigger
  let firstOption

  onMount(() => {
    const closeFromOutside = (event) => {
      if (root && !root.contains(event.target)) setOpen(false)
    }

    document.addEventListener('pointerdown', closeFromOutside)
    onCleanup(() => document.removeEventListener('pointerdown', closeFromOutside))
  })

  createEffect(() => {
    if (open()) queueMicrotask(() => firstOption?.focus())
  })

  function handleKeyDown(event) {
    if (event.key !== 'Escape' || !open()) return
    event.stopPropagation()
    setOpen(false)
    trigger?.focus()
  }

  function useMyLocation() {
    setOpen(false)
    props.onUseMyLocation?.()
  }

  function focusIncident() {
    setOpen(false)
    props.onFocusIncident?.()
    trigger?.focus()
  }

  const triggerLabel = () =>
    props.locating ? t('mapLocation.finding') : t('mapLocation.open')

  return (
    <div
      ref={root}
      class="map-overlay map-overlay--br gd-map-location"
      onKeyDown={handleKeyDown}
    >
      <Show when={open()}>
        <div
          id="map-location-options"
          class="gd-map-location__menu"
          role="group"
          aria-label={t('mapLocation.options')}
        >
          <button
            ref={firstOption}
            type="button"
            class="gd-map-location__option"
            disabled={!!props.locating}
            onClick={useMyLocation}
          >
            <span
              class="gd-map-location__option-icon"
              aria-hidden="true"
              innerHTML={locateIcon}
            />
            <span class="gd-map-location__copy">
              <strong>{t('topbar.useMyLocation')}</strong>
              <small>{t('mapLocation.center')}</small>
            </span>
          </button>

          <button
            type="button"
            class="gd-map-location__option"
            disabled={!props.canFocusIncident}
            onClick={focusIncident}
          >
            <span
              class="gd-map-location__option-icon"
              aria-hidden="true"
              innerHTML={mapIcon}
            />
            <span class="gd-map-location__copy">
              <strong>{t('mapLocation.goTo')}</strong>
              <small>
                {props.canFocusIncident ? t('mapLocation.showZone') : t('mapLocation.noIncident')}
              </small>
            </span>
          </button>
        </div>
      </Show>

      <button
        ref={trigger}
        type="button"
        class="gd-map-location__trigger"
        data-busy={props.locating ? 'true' : 'false'}
        disabled={!!props.locating}
        aria-busy={props.locating ? 'true' : 'false'}
        aria-expanded={open()}
        aria-controls="map-location-options"
        aria-label={triggerLabel()}
        title={props.locating ? t('mapLocation.finding') : t('mapLocation.title')}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          class="gd-map-location__trigger-icon"
          aria-hidden="true"
          innerHTML={locateIcon}
        />
      </button>
    </div>
  )
}
