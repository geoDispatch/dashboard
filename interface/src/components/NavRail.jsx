// Left navigation rail — Figma nodes 65:2 ("Primary navigation") and
// 68:2 ("Utility navigation"). The Figma export shipped a React + Tailwind
// reference; this file is the SolidJS + plain CSS rewrite of it, and nothing
// React-shaped survives in it — props are read, never destructured, and the
// component body runs once.
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

import { For } from 'solid-js'
import { num } from '../lib/format'
import { useT } from '../lib/i18n'

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
//
// Third is Devices (the ring-and-spokes locator glyph) and fifth is Rescue
// (the phone). They were the other way round; the glyphs kept their places
// and the sections traded, so each file is named for what it opens.
//
// Labels and hints are dictionary keys (lib/i18n.js), read at render time so
// a language change relabels the rail.
const PRIMARY_NAV = [
  { key: 'map',      label: 'nav.map',      hint: 'nav.mapHint',      icon: mapIcon },
  { key: 'details',  label: 'nav.details',  hint: 'nav.detailsHint',  icon: detailsIcon },
  { key: 'devices',  label: 'nav.devices',  hint: 'nav.devicesHint',  icon: devicesIcon },
  { key: 'shelters', label: 'nav.shelters', hint: 'nav.sheltersHint', icon: sheltersIcon },
  { key: 'rescue',   label: 'nav.rescue',   hint: 'nav.rescueHint',   icon: rescueIcon },
]

// All three open the same dialog, on the tab that answers what the word
// promises. Nothing here pretends to a session service: reaching this console
// at all means being on a station that already has an account, so the honest
// end of a shift is handing the desk over — which is what Station does.
//
// `highlight` is false for Sign out so that opening the dialog does not light
// up three tiles at once; it is a door, not a place you can be.
const UTILITY_NAV = [
  { key: 'account',  label: 'nav.account',  icon: accountIcon,  opens: 'station', highlight: true,
    hint: 'nav.accountHint' },
  { key: 'settings', label: 'nav.settings', icon: settingsIcon, opens: 'basemap', highlight: true,
    hint: 'nav.settingsHint' },
  { key: 'signout',  label: 'nav.signout',  icon: signOutIcon,  opens: 'station', highlight: false,
    hint: 'nav.signoutHint' },
]

// props.markup is read inside the JSX so the span re-renders if the glyph ever
// changes. The SVG inherits its stroke from the button's `color`.
function NavIcon(props) {
  return (
    <span class="navrail__icon" aria-hidden="true" innerHTML={props.markup} />
  )
}

export default function NavRail(props) {
  const t = useT()
  const isActive = (key) => props.active === key
  const badgeOf = (key) => props.badges?.[key]

  return (
    <div class="navrail">
      <nav class="navrail__nav" aria-label={t('nav.mainSections')}>
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
                      ? `${t(item.label)}, ${num(badgeOf(item.key))}`
                      : t(item.label)
                  }
                  title={
                    badgeOf(item.key)
                      ? `${t(item.hint)} (${num(badgeOf(item.key))})`
                      : t(item.hint)
                  }
                  onClick={() => props.onNavigate?.(item.key)}
                >
                  <NavIcon markup={item.icon} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>

      <nav class="navrail__nav" aria-label={t('nav.accountSession')}>
        <ul class="navrail__list">
          <For each={UTILITY_NAV}>
            {(item) => (
              <li class="navrail__item">
                <button
                  type="button"
                  class="navrail__btn navrail__btn--utility"
                  classList={{ 'navrail__btn--active': item.highlight && !!props.settingsOpen }}
                  aria-label={t(item.label)}
                  aria-expanded={!!props.settingsOpen}
                  title={t(item.hint)}
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
