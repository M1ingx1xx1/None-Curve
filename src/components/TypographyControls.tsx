import type { Dispatch } from 'react'
import type { LoadedFont } from '../font/model'
import {
  DEFAULT_TYPOGRAPHY,
  fitTextSize,
  TYPOGRAPHY_LIMITS,
  type ArtboardParams,
  type TextAlign,
  type TypographyParams,
} from '../specimen/artboard'
import type { SpecimenScene } from '../specimen/scene'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'
import SliderField from './SliderField'

interface TypographyControlsProps {
  params: TypographyParams
  artboard: ArtboardParams
  font: LoadedFont | null
  /** The laid-out text, used by Fit text. */
  scene: SpecimenScene | null
  disabled: boolean
  dispatch: Dispatch<Action>
}

const aligns: [TextAlign, string][] = [
  ['left', 'Left'],
  ['center', 'Center'],
  ['right', 'Right'],
]

/**
 * How the text is set on the canvas: size, spacing, slant, and alignment. These change the layout and
 * the SVG/PNG export, not the glyph outlines or the exported font.
 */
export default function TypographyControls({ params, artboard, font, scene, disabled, dispatch }: TypographyControlsProps) {
  const update = (patch: Partial<TypographyParams>) => dispatch({ type: 'updateParams', group: 'typography', patch })
  const intro = useHint()
  const alignHint = useHint()
  const emPx = Math.round((params.size / 100) * artboard.width * 10) / 10
  const isDefault = (Object.keys(DEFAULT_TYPOGRAPHY) as (keyof TypographyParams)[]).every(
    (k) => k === 'textCase' || params[k] === DEFAULT_TYPOGRAPHY[k],
  )
  const canFit = !disabled && font !== null && scene !== null && scene.glyphCount > 0

  return (
    <fieldset className="group typography" disabled={disabled}>
      <legend>
        Typography <HintButton hint={intro} topic="Typography" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={intro}>
          How the text is set on the canvas. These settings change the layout and the SVG and PNG export; the glyph
          outlines and the exported font file stay the same.
        </HintText>

        <SliderField
          id="type-size"
          label="Size"
          value={params.size}
          min={TYPOGRAPHY_LIMITS.minSize}
          max={TYPOGRAPHY_LIMITS.maxSize}
          step={0.1}
          unit="% W"
          valueText={`${params.size} percent of the canvas width, ${emPx} pixels`}
          hint={`Font size as a percentage of the canvas width, so the text keeps its proportions when the canvas changes size. Now ${emPx} px per em on a ${artboard.width} px wide canvas.`}
          onChange={(size) => update({ size })}
        />

        <div className="fit-row">
          <button
            type="button"
            className="button-small"
            disabled={!canFit}
            title="Largest size at which the whole text fits inside the padding"
            onClick={() => {
              if (font && scene) update({ size: fitTextSize(scene, params, artboard, font.metrics.unitsPerEm) })
            }}
          >
            Fit text
          </button>
        </div>
        <SliderField
          id="type-padding"
          label="Padding"
          value={params.padding}
          min={0}
          max={TYPOGRAPHY_LIMITS.maxPadding}
          step={1}
          unit="% W"
          valueText={`${params.padding} percent of the canvas width`}
          hint="Space kept free around the text on every side, as a percentage of the canvas width. Left and right alignment start at this margin, and Fit text keeps the whole text inside it."
          onChange={(padding) => update({ padding })}
        />

        <SliderField
          id="type-tracking"
          label="Tracking"
          value={params.tracking}
          min={TYPOGRAPHY_LIMITS.minTracking}
          max={TYPOGRAPHY_LIMITS.maxTracking}
          step={5}
          unit="/1000 em"
          valueText={`${params.tracking} thousandths of an em`}
          hint="Extra space between letters, in thousandths of an em (1000 = one em), added on top of the font's own spacing and kerning. Negative values pull letters together."
          onChange={(tracking) => update({ tracking })}
        />

        <SliderField
          id="type-leading"
          label="Line height"
          value={params.lineHeight}
          min={TYPOGRAPHY_LIMITS.minLineHeight}
          max={TYPOGRAPHY_LIMITS.maxLineHeight}
          step={0.01}
          unit="×"
          valueText={`${params.lineHeight} times the font's line spacing`}
          hint="Distance between lines (leading) as a multiple of the font's own line spacing. 1 keeps the spacing the font was designed with."
          onChange={(lineHeight) => update({ lineHeight })}
        />

        <SliderField
          id="type-slant"
          label="Slant"
          value={params.slant}
          min={-TYPOGRAPHY_LIMITS.maxSlant}
          max={TYPOGRAPHY_LIMITS.maxSlant}
          step={1}
          unit="°"
          valueText={`${params.slant} degrees`}
          hint="Leans every letter around its own baseline (a skew, like a quick oblique). Positive values lean right, negative values lean left."
          onChange={(slant) => update({ slant })}
        />

        <div className="field">
          <span className="field-title">
            <span className="field-label" id="type-align-label">
              Align
            </span>
            <HintButton hint={alignHint} topic="Align" />
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="type-align-label" aria-describedby={alignHint.id}>
            {aligns.map(([align, label]) => (
              <label key={align} className="segment-option">
                <input type="radio" name="type-align" value={align} checked={params.align === align} onChange={() => update({ align })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <HintText hint={alignHint}>
            Aligns the lines with each other and places the text block on the canvas: at the left padding, in the middle,
            or at the right padding. The block is always centred vertically.
          </HintText>
        </div>

        <button
          type="button"
          className="button-small"
          disabled={disabled || isDefault}
          onClick={() => update({ ...DEFAULT_TYPOGRAPHY, textCase: params.textCase })}
        >
          Reset typography
        </button>
      </div>
    </fieldset>
  )
}
