// Left navigation rail — Figma nodes 65:2 ("Primary navigation") and
// 68:2 ("Utility navigation"), converted from the React+Tailwind reference
// to SolidJS + plain CSS.
//
// The rail is icon-only, so every button carries both an aria-label (for
// screen readers) and a title (for the pointer tooltip). The active primary
// item is marked aria-current="page" and gets the Figma selected treatment:
// an #e5f0f7 tile at 12px radius with the icon restroked to #1f5278.
//
// Icons follow the house system: 24x24, stroke 1.75, stroke="currentColor".
// There is ONE file per nav item — no separate *-active export — because the
// selected colour is now a CSS concern. That only works if the SVG lives in
// the same document as the button, so each icon is imported with Vite's ?raw
// suffix and injected with innerHTML into a sized wrapper span; an <img> would
// be an isolated document and would resolve currentColor to its own black.

import { For, Show } from 'solid-js'
import { num } from '../lib/format'

import mapIcon from '../assets/icons/nav-map.svg?raw'
import detailsIcon from '../assets/icons/nav-details.svg?raw'
import rescueIcon from '../assets/icons/nav-rescue.svg?raw'
import sheltersIcon from '../assets/icons/nav-shelters.svg?raw'
import devicesIcon from '../assets/icons/nav-devices.svg?raw'
import accountIcon from '../assets/icons/nav-account.svg?raw'
import settingsIcon from '../assets/icons/nav-settings.svg?raw'
import signOutIcon from '../assets/icons/nav-sign-out.svg?raw'

import './NavRail.css'

// Every glyph is drawn on the same 24px grid at the same weight, so there is
// no per-item size correction any more — the wrapper is a flat 24x24 slot.
const PRIMARY_NAV = [
  { key: 'map',      label: 'Map',      hint: 'Live map',        icon: mapIcon },
  { key: 'details',  label: 'Details',  hint: 'Incident details', icon: detailsIcon },
  { key: 'rescue',   label: 'Rescue',   hint: 'Rescue queue',    icon: rescueIcon },
  { key: 'shelters', label: 'Shelters', hint: 'Shelters',        icon: sheltersIcon },
  { key: 'devices',  label: 'Devices',  hint: 'Devices by area', icon: devicesIcon },
]

// All three open the same dialog, on the tab that answers what the word
// promises. Nothing here pretends to a session service: reaching this console
// at all means being on a station that already has an account, so the honest
// end of a shift is handing the desk over — which is what Station does.
//
// `highlight` is false for Sign out so that opening the dialog does not light
// up three tiles at once; it is a door, not a place you can be.
const UTILITY_NAV = [
  { key: 'account',  label: 'Account',  icon: accountIcon,  opens: 'station', highlight: true,
    hint: 'Station profile' },
  { key: 'settings', label: 'Settings', icon: settingsIcon, opens: 'basemap', highlight: true,
    hint: 'Console settings' },
  { key: 'signout',  label: 'Sign out', icon: signOutIcon,  opens: 'station', highlight: false,
    hint: 'End shift — clears this station' },
]

// A four-digit count would blow past the 48px tile, so the pill caps its own
// text. The full value still reaches assistive tech through the button's
// accessible name.
function badgeText(count) {
  return count > 999 ? '999+' : String(count)
}

// props.markup is read inside the JSX so the span re-renders if the glyph ever
// changes. The SVG inherits its stroke from the button's `color`.
function NavIcon(props) {
  return (
    <span class="navrail__icon" aria-hidden="true" innerHTML={props.markup} />
  )
}

export default function NavRail(props) {
  const isActive = (key) => props.active === key
  const badgeOf = (key) => props.badges?.[key]

  return (
    <div class="navrail">
      <nav class="navrail__nav" aria-label="Main sections">
        <ul class="navrail__list">
          <For each={PRIMARY_NAV}>
            {(item) => (
              <li class="navrail__item">
                <button
                  type="button"
                  class="navrail__btn navrail__btn--primary"
                  classList={{ 'navrail__btn--active': isActive(item.key) }}
                  aria-current={isActive(item.key) ? 'page' : undefined}
                  aria-label={
                    badgeOf(item.key)
                      ? `${item.label}, ${num(badgeOf(item.key))}`
                      : item.label
                  }
                  title={
                    badgeOf(item.key)
                      ? `${item.hint} (${num(badgeOf(item.key))})`
                      : item.hint
                  }
                  onClick={() => props.onNavigate?.(item.key)}
                >
                  <NavIcon markup={item.icon} />
                  <Show when={badgeOf(item.key)}>
                    {(count) => (
                      <span class="navrail__badge" aria-hidden="true">
                        {badgeText(count())}
                      </span>
                    )}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>

      <nav class="navrail__nav" aria-label="Account and session">
        <ul class="navrail__list">
          <For each={UTILITY_NAV}>
            {(item) => (
              <li class="navrail__item">
                <button
                  type="button"
                  class="navrail__btn navrail__btn--utility"
                  classList={{ 'navrail__btn--active': item.highlight && !!props.settingsOpen }}
                  aria-label={item.label}
                  aria-expanded={!!props.settingsOpen}
                  title={item.hint}
                  onClick={() => props.onOpenSettings?.(item.opens)}
                >
                  <NavIcon markup={item.icon} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </div>
  )
}
