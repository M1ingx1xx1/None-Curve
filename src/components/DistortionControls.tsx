import type { Dispatch } from 'react'
import { DISTORTION_LIMITS, type DistortionStats } from '../geometry/distortion'
import type { DistortionParams } from '../geometry/types'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'

interface DistortionControlsProps {
  params: DistortionParams
  stats: DistortionStats | null
  finalVertices: number | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

export const DEFAULT_DISTORTION: DistortionParams = { amount: 0, frequency: 8, normalBias: 0.7, seed: 1 }
const MAX_SEED = 999_999

export default function DistortionControls({
  params,
  stats,
  finalVertices,
  pending,
  disabled,
  dispatch,
}: DistortionControlsProps) {
  const update = (patch: Partial<DistortionParams>) => dispatch({ type: 'updateParams', group: 'distortion', patch })
  const on = params.amount > 0
  const wavelength = Math.round(1000 / params.frequency)
  const introHint = useHint()
  const amountHint = useHint()
  const frequencyHint = useHint()
  const biasHint = useHint()
  const seedHint = useHint()
  const isDefault = (Object.keys(DEFAULT_DISTORTION) as (keyof DistortionParams)[]).every(
    (k) => params[k] === DEFAULT_DISTORTION[k],
  )

  return (
    <fieldset className="group distortion" disabled={disabled}>
      <legend>
        Distortion <HintButton hint={introHint} topic="Distortion" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Last step of the pipeline: moves the final vertices with deterministic noise, so it also moves them off the grid
          and off locked angles. Distortion changes detail and can hurt legibility.
        </HintText>

        <div className="field">
          <div className="field-head">
            <span className="field-title">
              <label htmlFor="distortion-amount">Noise amplitude</label>
              <HintButton hint={amountHint} topic="Noise amplitude" />
            </span>
            <output htmlFor="distortion-amount">
              {on ? params.amount : 'Off'}
              {on && <span className="unit">u</span>}
            </output>
          </div>
          <input
            id="distortion-amount"
            type="range"
            min={0}
            max={DISTORTION_LIMITS.maxAmount}
            step={1}
            value={params.amount}
            aria-valuetext={on ? `${params.amount} font units` : 'Off'}
            aria-describedby={amountHint.id}
            onChange={(e) => update({ amount: Number(e.target.value) })}
          />
          <HintText hint={amountHint}>
            Largest distance a vertex can move, in font units. 0 turns distortion off and leaves the outline unchanged.
          </HintText>
        </div>

        <div className="field">
          <div className="field-head">
            <span className="field-title">
              <label htmlFor="distortion-frequency">Noise frequency</label>
              <HintButton hint={frequencyHint} topic="Noise frequency" />
            </span>
            <output htmlFor="distortion-frequency">{params.frequency}</output>
          </div>
          <input
            id="distortion-frequency"
            type="range"
            min={DISTORTION_LIMITS.minFrequency}
            max={DISTORTION_LIMITS.maxFrequency}
            step={0.5}
            value={params.frequency}
            aria-valuetext={`${params.frequency} per 1000 font units`}
            aria-describedby={frequencyHint.id}
            onChange={(e) => update({ frequency: Number(e.target.value) })}
          />
          <HintText hint={frequencyHint}>
            Noise features per 1000 font units of outline length (one bump about every {wavelength} u). Measured along
            the outline, so it does not depend on zoom or vertex count. Higher values give a rougher edge.
          </HintText>
        </div>

        <div className="field">
          <div className="field-head">
            <span className="field-title">
              <label htmlFor="distortion-bias">Normal bias</label>
              <HintButton hint={biasHint} topic="Normal bias" />
            </span>
            <output htmlFor="distortion-bias">{Math.round(params.normalBias * 100)}%</output>
          </div>
          <input
            id="distortion-bias"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.normalBias}
            aria-valuetext={`${Math.round(params.normalBias * 100)} percent across the outline`}
            aria-describedby={biasHint.id}
            onChange={(e) => update({ normalBias: Number(e.target.value) })}
          />
          <HintText hint={biasHint}>
            0% slides vertices along the outline (tangent); 100% pushes them in and out across it (normal). Values in
            between mix both.
          </HintText>
        </div>

        <div className="field">
          <span className="field-title">
            <label htmlFor="distortion-seed">Seed</label>
            <HintButton hint={seedHint} topic="Seed" />
          </span>
          <div className="seed-row">
            <input
              id="distortion-seed"
              type="number"
              min={0}
              max={MAX_SEED}
              step={1}
              value={params.seed}
              aria-describedby={seedHint.id}
              onChange={(e) => {
                const value = Math.trunc(Number(e.target.value))
                if (Number.isFinite(value)) update({ seed: Math.min(MAX_SEED, Math.max(0, value)) })
              }}
            />
            <button type="button" className="button-small" onClick={() => update({ seed: (params.seed + 1) % (MAX_SEED + 1) })}>
              Next variant
            </button>
          </div>
          <HintText hint={seedHint}>
            The same seed and settings always produce the same shape. Next variant moves to the next seed.
          </HintText>
        </div>

        {stats?.applied && (
          <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
            <div>
              <dt>Seed</dt>
              <dd>{params.seed}</dd>
            </div>
            <div>
              <dt>Vertices</dt>
              <dd>{finalVertices ?? '—'}</dd>
            </div>
            <div>
              <dt>Max move</dt>
              <dd>
                {stats.maxShift.toFixed(1)}
                <span className="unit">u</span>
              </dd>
            </div>
          </dl>
        )}
        {stats && stats.clampedVertices > 0 && (
          <p className="field-hint">
            {stats.clampedVertices} {stats.clampedVertices === 1 ? 'vertex moves' : 'vertices move'} less than the
            amplitude to protect short edges and sharp turns.
          </p>
        )}
        {stats && stats.reducedContours > 0 && (
          <p className="font-warning">
            {stats.reducedContours} {stats.reducedContours === 1 ? 'contour uses' : 'contours use'} a smaller amplitude
            because the full amount reversed it or made it cross itself.
          </p>
        )}
        {stats && stats.fallbackContours > 0 && (
          <p className="font-warning">
            {stats.fallbackContours} {stats.fallbackContours === 1 ? 'contour is' : 'contours are'} left undistorted: even a
            sixteenth of the amplitude made {stats.fallbackContours === 1 ? 'it' : 'them'} invalid.
          </p>
        )}

        <button type="button" className="button-small" disabled={disabled || isDefault} onClick={() => update(DEFAULT_DISTORTION)}>
          Reset distortion
        </button>
      </div>
    </fieldset>
  )
}
