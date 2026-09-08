// Left navigation rail — Figma nodes 65:2 ("Primary navigation") and
// 68:2 ("Utility navigation"), converted from the React+Tailwind reference
// to SolidJS + plain CSS.
//
// The rail is icon-only, so every button carries both an aria-label (for
// screen readers) and a title (for the pointer tooltip). The active primary
// item is marked aria-current="page" and gets the Figma selected treatment:
// an #e5f0f7 tile at 12px radius with the icon restroked to #1f5278.
//
// Icon assets are the real Figma exports. Each primary icon ships as two
// files — idle stroke (#5E6B75) and selected stroke (#1F5278) — because an
// <img>-referenced SVG cannot inherit its colour from CSS.

import { For, Show } from 'solid-js'
import { num } from '../lib/format'

import mapIcon from '../assets/icons/nav-map.svg'
import mapIconActive from '../assets/icons/nav-map-active.svg'
import rescueIcon from '../assets/icons/nav-rescue.svg'
import rescueIconActive from '../assets/icons/nav-rescue-active.svg'
import sheltersIcon from '../assets/icons/nav-shelters.svg'
import sheltersIconActive from '../assets/icons/nav-shelters-active.svg'
import devicesIcon from '../assets/icons/nav-devices.svg'
import devicesIconActive from '../assets/icons/nav-devices-active.svg'
import accountIcon from '../assets/icons/nav-account.svg'
import settingsIcon from '../assets/icons/nav-settings.svg'
import signOutIcon from '../assets/icons/nav-sign-out.svg'

import './NavRail.css'

// `size` is the icon's own artboard size in px. Figma draws these 24px glyphs
// on a slightly larger canvas so the stroke is not clipped (the `inset-[-x%]`
// wrappers in the reference code). Rendering each at its natural size inside
// a 24px slot reproduces that bleed exactly and keeps the glyphs optically equal.
const PRIMARY_NAV = [
  { key: 'map',      label: 'Map',      hint: 'Live map',        icon: mapIcon,      iconActive: mapIconActive,      size: 27 },
  { key: 'rescue',   label: 'Rescue',   hint: 'Rescue queue',    icon: rescueIcon,   iconActive: rescueIconActive,   size: 27 },
  { key: 'shelters', label: 'Shelters', hint: 'Shelters',        icon: sheltersIcon, iconActive: sheltersIconActive, size: 27 },
  { key: 'devices',  label: 'Devices',  hint: 'Devices by area', icon: devicesIcon,  iconActive: devicesIconActive,  size: 30 },
]

const UTILITY_NAV = [
  { key: 'account',  label: 'Account',  icon: accountIcon,  size: 28 },
  { key: 'settings', label: 'Settings', icon: settingsIcon, size: 27.1 },
  { key: 'signout',  label: 'Sign out', icon: signOutIcon,  size: 27.3 },
]

// A four-digit count would blow past the 48px tile, so the pill caps its own
// text. The full value still reaches assistive tech through the button's
// accessible name.
function badgeText(count) {
  return count > 999 ? '999+' : String(count)
}

// props.src / props.size are read inside the JSX, so the <img> re-renders when
// the active item changes.
function NavIcon(props) {
  return (
    <span class="navrail__icon" style={{ '--nav-icon-size': `${props.size}px` }}>
      <img src={props.src} alt="" />
    </span>
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
                  <NavIcon
                    src={isActive(item.key) ? item.iconActive : item.icon}
                    size={item.size}
                  />
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
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => props.onAuthNote?.(item.label)}
                >
                  <NavIcon src={item.icon} size={item.size} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </div>
  )
}
