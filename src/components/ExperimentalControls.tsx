import type { Dispatch, ReactNode } from 'react'
import { EXPERIMENTAL_LIMITS, type ExperimentalStats } from '../geometry/experimental'
import { NOISE_LIMITS } from '../geometry/noise'
import { RIPPLE_LIMITS } from '../geometry/ripple'
import type { ExperimentalParams, NoiseParams, RippleParams, WindParams } from '../geometry/types'
import type { WarpStats } from '../geometry/warp'
import { WIND_LIMITS } from '../geometry/wind'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint, type HintState } from './Hint'
import Icon from './Icon'

interface ExperimentalControlsProps {
  params: ExperimentalParams
  stats: ExperimentalStats | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
  /** Which glyph the statistics describe, shown in the intro like on the Geometry tab. */
  statistics?: ReactNode
}

export const DEFAULT_EXPERIMENTAL: ExperimentalParams = {
  seed: 1,
  noise: { enabled: false, amount: 0.7, facet: 0.18 },
  ripple: { enabled: false, amount: 0.5, wavelength: 0.3, sides: 8, centerX: 0.5, centerY: 0.5, fade: 0 },
  wind: { enabled: false, direction: 0, strength: 0.3, gust: 0.12, gustiness: 0.6 },
}

const percent = (v: number) => Math.round(v * 100)

/**
 * The Experimental tab: effects that run after the whole Geometry pipeline and can all be on at once.
 * Each folds the letter along straight creases, so it adds corners but never curves.
 */
export default function ExperimentalControls({ params, stats, pending, disabled, dispatch, statistics }: ExperimentalControlsProps) {
  const update = (patch: Partial<ExperimentalParams>) => dispatch({ type: 'updateParams', group: 'experimental', patch })
  const introHint = useHint()
  const seedHint = useHint()
  // Reset keeps the seed, so a variant the user liked is not lost.
  const isDefault = JSON.stringify({ ...params, seed: 0 }) === JSON.stringify({ ...DEFAULT_EXPERIMENTAL, seed: 0 })

  return (
    <>
      <div className="panel-notice panel-intro">
        <p className="field-title">
          <span>Runs after Geometry: Noise → Ripple → Wind. Effects can be on together.</span>
          <HintButton hint={introHint} topic="Experimental effects" />
        </p>
        {statistics}
        <HintText hint={introHint}>
          Each effect folds the letters along straight creases, so it adds corners but never curves, and any
          combination keeps every letter valid. Statistics are for the selected glyph.
        </HintText>
      </div>

      <NoiseGroup params={params.noise} stats={stats?.noise ?? null} pending={pending} disabled={disabled} onChange={(noise) => update({ noise })} />
      <RippleGroup params={params.ripple} stats={stats?.ripple ?? null} pending={pending} disabled={disabled} onChange={(ripple) => update({ ripple })} />
      <WindGroup params={params.wind} stats={stats?.wind ?? null} pending={pending} disabled={disabled} onChange={(wind) => update({ wind })} />

      <fieldset className="group experimental" disabled={disabled}>
        <legend>Seed</legend>
        <div className="group-body">
          <div className="field">
            <span className="field-title">
              <label htmlFor="experimental-seed">Seed</label>
              <HintButton hint={seedHint} topic="Seed" />
            </span>
            <div className="seed-row">
              <input
                id="experimental-seed"
                type="number"
                min={0}
                max={EXPERIMENTAL_LIMITS.maxSeed}
                step={1}
                value={params.seed}
                aria-describedby={seedHint.id}
                onChange={(e) => {
                  const value = Math.trunc(Number(e.target.value))
                  if (Number.isFinite(value)) update({ seed: Math.min(EXPERIMENTAL_LIMITS.maxSeed, Math.max(0, value)) })
                }}
              />
              <button
                type="button"
                className="button-small"
                onClick={() => update({ seed: (params.seed + 1) % (EXPERIMENTAL_LIMITS.maxSeed + 1) })}
              >
                <Icon name="next" />
                Next variant
              </button>
            </div>
            <HintText hint={seedHint}>
              Picks Noise’s folds and Wind’s gusts; Ripple has no randomness. The same seed and settings always produce
              the same letters.
            </HintText>
          </div>

          <button
            type="button"
            className="button-small"
            disabled={disabled || isDefault}
            onClick={() => update({ ...DEFAULT_EXPERIMENTAL, seed: params.seed })}
          >
            <Icon name="reset" />
            Reset experimental
          </button>
        </div>
      </fieldset>
    </>
  )
}

interface GroupProps<T> {
  params: T
  stats: WarpStats | null
  pending: boolean
  disabled: boolean
  onChange: (params: T) => void
}

function NoiseGroup({ params, stats, pending, disabled, onChange }: GroupProps<NoiseParams>) {
  const update = (patch: Partial<NoiseParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const amountHint = useHint()
  const facetHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Noise <HintButton hint={introHint} topic="Noise" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Crumples the letters like paper: the plane is cut into triangles that each move a little, so the outline bends
          only along straight creases. Counters and the strokes around them fold together.
        </HintText>

        <div className="field field-toggle">
          <input id="noise-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="noise-enabled">Use noise</label>
        </div>

        <RangeField
          id="noise-amount"
          label="Amount"
          value={params.amount}
          min={0}
          max={NOISE_LIMITS.maxAmount}
          step={0.1}
          display={`${percent(params.amount)}%`}
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          hint={amountHint}
          hintText="How far the folds move the outline. Above 100% the letters are crumpled a second time along the same folds, for deeper, sharper creases."
          onChange={(amount) => update({ amount })}
        />
        <RangeField
          id="noise-facet"
          label="Facet size"
          value={params.facet}
          min={NOISE_LIMITS.minFacet}
          max={NOISE_LIMITS.maxFacet}
          step={0.02}
          display={percent(params.facet)}
          unit="% em"
          valueText={`${percent(params.facet)} percent of the em`}
          disabled={off}
          hint={facetHint}
          hintText="Size of the triangles, as a share of the em. Larger facets give fewer, bigger folds; the smallest still keeps creases far enough apart to read as corners."
          onChange={(facet) => update({ facet })}
        />

        <EffectStats stats={stats} pending={pending} effect="noise" />
      </div>
    </fieldset>
  )
}

function RippleGroup({ params, stats, pending, disabled, onChange }: GroupProps<RippleParams>) {
  const update = (patch: Partial<RippleParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const wavelengthHint = useHint()
  const centerHint = useHint()
  const fadeHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Ripple <HintButton hint={introHint} topic="Ripple" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Waves spread from a point as rings of straight-sided polygons. Each ring is pushed out or pulled in, in turn, so
          the outline zigzags where it crosses them. Runs after Noise.
        </HintText>

        <div className="field field-toggle">
          <input id="ripple-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="ripple-enabled">Use ripple</label>
        </div>

        <RangeField
          id="ripple-amount"
          label="Amount"
          value={params.amount}
          min={0}
          max={1}
          step={0.1}
          display={`${percent(params.amount)}%`}
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          onChange={(amount) => update({ amount })}
        />
        <RangeField
          id="ripple-wavelength"
          label="Wavelength"
          value={params.wavelength}
          min={RIPPLE_LIMITS.minWavelength}
          max={RIPPLE_LIMITS.maxWavelength}
          step={0.02}
          display={percent(params.wavelength)}
          unit="% em"
          valueText={`${percent(params.wavelength)} percent of the em`}
          disabled={off}
          hint={wavelengthHint}
          hintText="Distance from one crest to the next, as a share of the em. Rings fall half of it apart."
          onChange={(wavelength) => update({ wavelength })}
        />
        <RangeField
          id="ripple-sides"
          label="Sides"
          value={params.sides}
          min={RIPPLE_LIMITS.minSides}
          max={RIPPLE_LIMITS.maxSides}
          step={1}
          display={params.sides}
          valueText={`${params.sides} sides`}
          disabled={off}
          onChange={(sides) => update({ sides })}
        />
        <RangeField
          id="ripple-center-x"
          label="Center X"
          value={params.centerX}
          min={RIPPLE_LIMITS.minCenter}
          max={RIPPLE_LIMITS.maxCenter}
          step={0.1}
          display={`${percent(params.centerX)}%`}
          valueText={`${percent(params.centerX)} percent across the letter`}
          disabled={off}
          hint={centerHint}
          hintText="Where the waves start, as a share of each letter’s width and height: 0% is the left or bottom edge, 100% the right or top. Values beyond put the center outside the letter."
          onChange={(centerX) => update({ centerX })}
        />
        <RangeField
          id="ripple-center-y"
          label="Center Y"
          value={params.centerY}
          min={RIPPLE_LIMITS.minCenter}
          max={RIPPLE_LIMITS.maxCenter}
          step={0.1}
          display={`${percent(params.centerY)}%`}
          valueText={`${percent(params.centerY)} percent up the letter`}
          disabled={off}
          onChange={(centerY) => update({ centerY })}
        />
        <RangeField
          id="ripple-fade"
          label="Fade"
          value={params.fade}
          min={0}
          max={1}
          step={0.1}
          display={`${percent(params.fade)}%`}
          valueText={`${percent(params.fade)} percent`}
          disabled={off}
          hint={fadeHint}
          hintText="How much the waves die down away from the center. At 100% they are gone by the farthest point of the letter."
          onChange={(fade) => update({ fade })}
        />

        <EffectStats stats={stats} pending={pending} effect="ripple" />
      </div>
    </fieldset>
  )
}

function WindGroup({ params, stats, pending, disabled, onChange }: GroupProps<WindParams>) {
  const update = (patch: Partial<WindParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const directionHint = useHint()
  const strengthHint = useHint()
  const gustHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Wind <HintButton hint={introHint} topic="Wind" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Draws the letters out in the wind’s direction. The side facing the wind stays put; the further downwind, the
          more the outline is pulled, and gusts pull some bands further than others, leaving ragged, straight-edged
          streaks. Runs after Ripple.
        </HintText>

        <div className="field field-toggle">
          <input id="wind-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="wind-enabled">Use wind</label>
        </div>

        <RangeField
          id="wind-direction"
          label="Direction"
          value={params.direction}
          min={0}
          max={345}
          step={15}
          display={`${Math.round(params.direction)}°`}
          valueText={`${Math.round(params.direction)} degrees`}
          disabled={off}
          hint={directionHint}
          hintText="Where the wind blows to: 0° to the right, 90° up, 180° to the left, 270° down."
          onChange={(direction) => update({ direction })}
        />
        <RangeField
          id="wind-strength"
          label="Strength"
          value={params.strength}
          min={0}
          max={WIND_LIMITS.maxStrength}
          step={0.1}
          display={`${percent(params.strength)}%`}
          valueText={`${percent(params.strength)} percent`}
          disabled={off}
          hint={strengthHint}
          hintText="How much longer the letters get in a full gust: at 100% a part of the letter is pulled as far again as it lies downwind of the edge facing the wind, at 300% three times as far."
          onChange={(strength) => update({ strength })}
        />
        <RangeField
          id="wind-gust"
          label="Gust size"
          value={params.gust}
          min={WIND_LIMITS.minGust}
          max={WIND_LIMITS.maxGust}
          step={0.02}
          display={percent(params.gust)}
          unit="% em"
          valueText={`${percent(params.gust)} percent of the em`}
          disabled={off}
          hint={gustHint}
          hintText="Width of each band that a gust pulls, as a share of the em. With a level wind, every letter on a line shares the same bands."
          onChange={(gust) => update({ gust })}
        />
        <RangeField
          id="wind-gustiness"
          label="Gustiness"
          value={params.gustiness}
          min={0}
          max={1}
          step={0.1}
          display={`${percent(params.gustiness)}%`}
          valueText={`${percent(params.gustiness)} percent`}
          disabled={off}
          onChange={(gustiness) => update({ gustiness })}
        />

        <EffectStats stats={stats} pending={pending} effect="wind" />
      </div>
    </fieldset>
  )
}

interface RangeFieldProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  display: ReactNode
  unit?: string
  valueText: string
  disabled: boolean
  hint?: HintState
  hintText?: string
  onChange: (value: number) => void
}

/** A labelled slider with its value; an optional ⓘ explanation. */
function RangeField({ id, label, value, min, max, step, display, unit, valueText, disabled, hint, hintText, onChange }: RangeFieldProps) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-title">
          <label htmlFor={id}>{label}</label>
          {hint && <HintButton hint={hint} topic={label} />}
        </span>
        <output htmlFor={id}>
          {display}
          {unit && <span className="unit">{unit}</span>}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={valueText}
        aria-describedby={hint?.id}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && hintText && <HintText hint={hint}>{hintText}</HintText>}
    </div>
  )
}

/** Largest move and creases added, plus warnings when an effect had to be weakened or left out. */
function EffectStats({ stats, pending, effect }: { stats: WarpStats | null; pending: boolean; effect: string }) {
  if (!stats?.applied) return null
  return (
    <>
      <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
        <div>
          <dt>Max move</dt>
          <dd>
            {stats.maxShift.toFixed(1)}
            <span className="unit">u</span>
          </dd>
        </div>
        <div>
          <dt>Creases</dt>
          <dd>+{stats.addedVertices}</dd>
        </div>
      </dl>
      {stats.reducedContours > 0 && (
        <p className="font-warning">
          {stats.reducedContours} {stats.reducedContours === 1 ? 'contour uses' : 'contours use'} a weaker {effect} to stay
          valid.
        </p>
      )}
      {stats.fallbackContours > 0 && <p className="font-warning">This glyph is left without {effect}: no strength kept it valid.</p>}
    </>
  )
}
