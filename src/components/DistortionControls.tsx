import { memo, type Dispatch } from 'react'
import { DISTORTION_LIMITS, type DistortionStats } from '../geometry/distortion'
import type { DistortionParams } from '../geometry/types'
import { useLiveSeed } from '../sound/live'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'
import Icon from './Icon'
import LiveSeed from './LiveSeed'
import NumberField from './NumberField'
import SliderField from './SliderField'
import { sameControlProps } from './sameControlProps'

interface DistortionControlsProps {
  params: DistortionParams
  stats: DistortionStats | null
  finalVertices: number | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

export const DEFAULT_DISTORTION: DistortionParams = { amount: 0, frequency: 8, normalBias: 0.7, seed: 1, sparse: false }

function DistortionControls({
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
  const seedHint = useHint()
  // The statistics come from the letters as shown, so while Sound moves the seed on they belong to its live seed.
  const shownSeed = useLiveSeed('distortion.seed') ?? params.seed
  // Reset keeps the seed, so a variant the user liked is not lost. Few anchors missing in older settings counts as off.
  const isDefault = (Object.keys(DEFAULT_DISTORTION) as (keyof DistortionParams)[]).every(
    (k) => k === 'seed' || (params[k] ?? DEFAULT_DISTORTION[k]) === DEFAULT_DISTORTION[k],
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

        <SliderField
          id="distortion-amount"
          target="distortion.amount"
          label="Noise amplitude"
          value={params.amount}
          unit="u"
          valueText={on ? `${params.amount} font units` : 'Off'}
          onChange={(amount) => update({ amount })}
        />

        <SliderField
          id="distortion-frequency"
          target="distortion.frequency"
          label="Noise frequency"
          value={params.frequency}
          valueText={`${params.frequency} per 1000 font units`}
          hint={`Noise features per 1000 font units of outline length (one bump about every ${wavelength} u). Measured along the outline, so it does not depend on zoom or vertex count. Higher values give a rougher edge.`}
          onChange={(frequency) => update({ frequency })}
        />

        <SliderField
          id="distortion-bias"
          target="distortion.normalBias"
          label="Normal bias"
          value={params.normalBias}
          scale={100}
          unit="%"
          valueText={`${Math.round(params.normalBias * 100)} percent across the outline`}
          hint="0% slides vertices along the outline (tangent); 100% pushes them in and out across it (normal). Values in between mix both."
          onChange={(normalBias) => update({ normalBias })}
        />

        <div className="field">
          <span className="field-title">
            <label htmlFor="distortion-seed">Seed</label>
            <HintButton hint={seedHint} topic="Seed" />
          </span>
          <div className="seed-row">
            <NumberField
              id="distortion-seed"
              plain
              min={0}
              max={DISTORTION_LIMITS.maxSeed}
              step={1}
              value={params.seed}
              aria-describedby={seedHint.id}
              onCommit={(seed) => update({ seed })}
            />
            <LiveSeed target="distortion.seed" />
            <button type="button" className="button-small" onClick={() => update({ seed: (params.seed + 1) % (DISTORTION_LIMITS.maxSeed + 1) })}>
              <Icon name="next" />
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
              <dd>{shownSeed}</dd>
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
            {params.sparse && (
              <div>
                <dt>Anchors moved</dt>
                <dd>{stats.movedAnchors}</dd>
              </div>
            )}
          </dl>
        )}
        {stats && stats.clampedVertices > 0 && (
          <p className="field-hint">
            {stats.clampedVertices} {stats.clampedVertices === 1 ? 'vertex moves' : 'vertices move'} less than the
            amplitude so no edge collapses or folds back.
          </p>
        )}
        {stats && stats.reducedContours > 0 && (
          <p className="font-warning">
            {stats.reducedContours} {stats.reducedContours === 1 ? 'contour uses' : 'contours use'} a lower amplitude
            where the full amount made {stats.reducedContours === 1 ? 'it' : 'them'} cross{' '}
            {stats.reducedContours === 1 ? 'itself' : 'themselves'} or another contour.
          </p>
        )}
        {stats && stats.fallbackContours > 0 && (
          <p className="font-warning">
            {stats.fallbackContours} {stats.fallbackContours === 1 ? 'contour is' : 'contours are'} left undistorted: even a
            sixteenth of the amplitude made {stats.fallbackContours === 1 ? 'it' : 'them'} invalid.
          </p>
        )}

        {/* Few anchors has no control of its own: only the Sound tab's Flicker preset turns it on. */}
        {params.sparse && (
          <p className="field-hint">
            Only a few anchors move (set by the Flicker preset in the Sound tab). Reset distortion moves every anchor again.
          </p>
        )}

        <button type="button" className="button-small" disabled={disabled || isDefault} onClick={() => update({ ...DEFAULT_DISTORTION, seed: params.seed })}>
          <Icon name="reset" />
          Reset distortion
        </button>
      </div>
    </fieldset>
  )
}

// Live frames re-render the panel; a group skips them unless its own props or statistics change.
export default memo(DistortionControls, sameControlProps)
