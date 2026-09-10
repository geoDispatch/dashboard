import { For, Show } from 'solid-js'
import { DASH } from '../lib/format'
import { PHASES, SOURCE_LABEL, streamChip, streamSentence } from '../lib/streamState'
// Inlined with Vite's ?raw suffix, not <img src>. An SVG behind <img> is an
// isolated document, so stroke="currentColor" would resolve to that document's
// own black; inlining lets the button's `color` reach the glyph, which is what
// makes the hover and active states move the icon with the surface.
import fullscreenIcon from '../assets/icons/fullscreen.svg?raw'
import exportIcon from '../assets/icons/export.svg?raw'
import './MapToolbar.css'

// The three map layers. More than one may be on at a time, so these are
// independent toggle buttons (aria-pressed), not a radio group.
const LAYERS = [
  { key: 'zones',    label: 'Zones',    hint: 'Show the red, orange and green zone rings' },
  { key: 'devices',  label: 'Devices',  hint: 'Show one dot per located device' },
  { key: 'shelters', label: 'Shelters', hint: 'Show the shelter markers' },
]

// The pill's words come from one place — lib/streamState.js — so the toolbar,
// the settings readout and the incident page cannot describe the same stream
// differently. The pill never says "live": an open socket is not a live
// stream, and the supervisor behind it may be reading Nokia CAMARA or its own
// bundled mocks, which is not something this console can see.

export default function MapToolbar(props) {
  const isDemo = () => props.source === 'demo'
  const source = () => (isDemo() ? 'demo' : 'supervisor')

  // Anything unrecognised is treated as "connecting" rather than as healthy:
  // an unknown state must never read as a good one.
  const phase = () => (PHASES.includes(props.phase) ? props.phase : 'connecting')

  const chip = () => streamChip(phase(), source())
  const labelText = () => chip().text

  const fpsNumber = () => (Number.isFinite(props.fps) ? Math.round(props.fps) : null)
  const fpsText = () => (fpsNumber() === null ? DASH : `${fpsNumber()}/s`)

  const layerOn = (key) => !!(props.layers && props.layers[key])

  // props.netLabel is the operator's OWN link — the Wi-Fi this browser sits on.
  // It is not the disaster area's cell congestion (that is a backend gap), so
  // every place it appears says whose connection it describes.
  const netSentence = () => {
    if (!props.netLabel) return ''
    const quality = props.netQuality ? `, ${props.netQuality}` : ''
    return `This browser's connection: ${props.netLabel}${quality}.`
  }

  const streamLine = () => {
    const rate = fpsNumber() === null
      ? 'Frame rate unknown.'
      : `${fpsNumber()} frames per second.`
    return `${SOURCE_LABEL[source()]}. ${labelText()}. ${rate} ${streamSentence(phase(), source())}`
  }

  const pillTitle = () => {
    const net = netSentence()
    return net ? `${streamLine()}\n${net}` : streamLine()
  }

  return (
    <div class="map-toolbar" role="group" aria-label="Map controls">
      <div
        class="mt-stream"
        data-status={phase()}
        data-tone={chip().tone}
        data-source={source()}
        title={pillTitle()}
      >
        <span class="mt-dot" aria-hidden="true" />
        <span class="mt-stream-label">{labelText()}</span>
        <span class="mt-stream-fps" aria-hidden="true">{fpsText()}</span>

        <span class="mt-sr" aria-live="polite">{streamLine()}</span>
        <Show when={netSentence()}>
          <span class="mt-sr">{netSentence()}</span>
        </Show>
      </div>

      <div class="mt-layers" role="group" aria-label="Map layers">
        <For each={LAYERS}>
          {(layer) => (
            <button
              type="button"
              class="mt-seg"
              aria-pressed={layerOn(layer.key)}
              /* The visible word must survive into the accessible name, so the
                 hint is the tooltip only — a bare title would replace it. */
              aria-label={`${layer.label} layer`}
              title={layer.hint}
              onClick={() => props.onToggleLayer?.(layer.key)}
            >
              {layer.label}
            </button>
          )}
        </For>
      </div>

      <button
        type="button"
        class="mt-icon-btn mt-fullscreen"
        aria-label="Toggle fullscreen map"
        title="Fullscreen"
        onClick={() => props.onFullscreen?.()}
      >
        <span
          class="mt-icon-box mt-icon-box-22"
          aria-hidden="true"
          innerHTML={fullscreenIcon}
        />
      </button>

      <button
        type="button"
        class="mt-icon-btn mt-export"
        aria-label="Export the current event and devices as JSON"
        title="Export JSON"
        onClick={() => props.onExport?.()}
      >
        <span
          class="mt-icon-box mt-icon-box-22"
          aria-hidden="true"
          innerHTML={exportIcon}
        />
      </button>
    </div>
  )
}
