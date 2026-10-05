import { useEffect, useState, type Dispatch } from 'react'
import { contrastRatio, DEFAULT_PALETTE, normalizeHex, PALETTES, type PaletteParams } from '../specimen/artboard'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'

interface ColorControlsProps {
  params: PaletteParams
  disabled: boolean
  dispatch: Dispatch<Action>
}

/** Below this contrast ratio text is hard to read (WCAG: 3 for large text). */
const LOW_CONTRAST = 3

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** A random pair with readable contrast: a bright colour on a deep one, or the other way round. */
function randomPalette(): PaletteParams {
  for (let attempt = 0; attempt < 20; attempt++) {
    const hue = Math.random() * 360
    const bright = hslToHex(hue, 0.6 + Math.random() * 0.35, 0.6 + Math.random() * 0.2)
    const deep = hslToHex((hue + [0, 0, 30, 180][Math.floor(Math.random() * 4)]) % 360, 0.3 + Math.random() * 0.4, 0.05 + Math.random() * 0.08)
    const pair = Math.random() < 0.75 ? { ink: bright, paper: deep } : { ink: deep, paper: bright }
    if (contrastRatio(pair.ink, pair.paper) >= 4.5) return pair
  }
  return DEFAULT_PALETTE
}

/** Text and background colours of the canvas, the preview, and SVG/PNG export. */
export default function ColorControls({ params, disabled, dispatch }: ColorControlsProps) {
  const update = (patch: Partial<PaletteParams>) => dispatch({ type: 'updateParams', group: 'palette', patch })
  const intro = useHint()
  const active = PALETTES.find((p) => p.ink === params.ink && p.paper === params.paper)
  const contrast = contrastRatio(params.ink, params.paper)

  return (
    <fieldset className="group colors" disabled={disabled}>
      <legend>
        Color <HintButton hint={intro} topic="Color" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={intro}>
          The text and background colours of the canvas. The preview and SVG / PNG export use them too; the exported font
          file has no colour.
        </HintText>

        <div className="field">
          <span className="field-label" id="palette-presets-label">
            Presets
          </span>
          <div className="palette-grid" role="group" aria-labelledby="palette-presets-label">
            {PALETTES.map((p) => (
              <button
                key={p.name}
                type="button"
                aria-pressed={active?.name === p.name}
                className="palette-option"
                onClick={() => update({ ink: p.ink, paper: p.paper })}
              >
                <span className="palette-dot" style={{ background: p.ink }} aria-hidden="true" />
                <span className="palette-dot" style={{ background: p.paper }} aria-hidden="true" />
                <span className="palette-name">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="preset-row">
            <button type="button" className="button-small" onClick={() => update(randomPalette())}>
              Random
            </button>
            <button type="button" className="button-small" onClick={() => update({ ink: params.paper, paper: params.ink })}>
              Swap
            </button>
          </div>
        </div>

        <ColorField id="palette-ink" label="Text" value={params.ink} onChange={(ink) => update({ ink })} />
        <ColorField id="palette-paper" label="Background" value={params.paper} onChange={(paper) => update({ paper })} />

        <p className={contrast < LOW_CONTRAST ? 'font-warning' : 'field-hint'} aria-live="polite">
          Contrast {contrast.toFixed(1)} : 1{active ? ` · ${active.name}` : ' · custom'}
          {contrast < LOW_CONTRAST ? ' — the text will be hard to read.' : ''}
        </p>
      </div>
    </fieldset>
  )
}

/** A colour swatch (the native picker) with a hex box for exact values. */
function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const invalid = normalizeHex(draft) === null

  const commit = () => {
    const hex = normalizeHex(draft)
    if (hex) {
      setDraft(hex)
      if (hex !== value) onChange(hex)
    } else setDraft(value)
  }

  return (
    <div className="field color-field">
      <label htmlFor={id}>{label}</label>
      <div className="color-row">
        <input id={id} type="color" className="color-swatch" value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          type="text"
          className="color-hex"
          value={draft}
          spellCheck={false}
          aria-label={`${label} colour, hex`}
          aria-invalid={invalid}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(value)
          }}
        />
      </div>
    </div>
  )
}
