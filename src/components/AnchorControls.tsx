import type { Dispatch } from 'react'
import { ANCHOR_LIMITS, type AnchorStats } from '../geometry/anchors'
import type { AnchorParams } from '../geometry/types'
import type { Action } from '../state/editorState'

interface AnchorControlsProps {
  params: AnchorParams
  stats: AnchorStats | null
  unitsPerEm: number | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

const SPACING_MAX = 200
const SIMPLIFY_MAX = 100

function emPercent(value: number, unitsPerEm: number | null): string {
  return unitsPerEm ? ` (${((value / unitsPerEm) * 100).toFixed(2)}% of the em)` : ''
}

function Step({ label, value, active }: { label: string; value: number | string; active: boolean }) {
  return (
    <div className="pipeline-step" data-active={active}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export default function AnchorControls({ params, stats, unitsPerEm, pending, disabled, dispatch }: AnchorControlsProps) {
  const update = (patch: Partial<AnchorParams>) => dispatch({ type: 'updateParams', group: 'anchors', patch })
  const spacingOn = params.spacing > 0
  const reductionOn = params.simplify > 0

  return (
    <fieldset className="group anchors" disabled={disabled}>
      <legend>Anchors</legend>
      <p className="field-hint">
        Runs after flattening, in a fixed order: Flatten → Spacing → Reduction. Each change is recomputed from the
        original curves.
      </p>

      <div className="field">
        <div className="field-head">
          <label htmlFor="anchor-spacing">Anchor spacing</label>
          <output htmlFor="anchor-spacing">
            {spacingOn ? params.spacing : 'Off'}
            {spacingOn && <span className="unit">u</span>}
          </output>
        </div>
        <input
          id="anchor-spacing"
          type="range"
          min={0}
          max={SPACING_MAX}
          step={1}
          value={params.spacing}
          aria-valuetext={spacingOn ? `${params.spacing} font units` : 'Off'}
          aria-describedby="anchor-spacing-hint"
          onChange={(e) => update({ spacing: Number(e.target.value) })}
        />
        <p id="anchor-spacing-hint" className="field-hint">
          Splits every polygon edge so no edge is longer than this{spacingOn ? emPercent(params.spacing, unitsPerEm) : ''}.
          New points sit on the existing edges, so the shape does not change. 0 turns it off.
        </p>
      </div>

      <div className="field">
        <div className="field-head">
          <label htmlFor="anchor-simplify">Anchor reduction</label>
          <output htmlFor="anchor-simplify">
            {reductionOn ? params.simplify : 'Off'}
            {reductionOn && <span className="unit">u</span>}
          </output>
        </div>
        <input
          id="anchor-simplify"
          type="range"
          min={0}
          max={SIMPLIFY_MAX}
          step={0.5}
          value={params.simplify}
          aria-valuetext={reductionOn ? `${params.simplify} font units` : 'Off'}
          aria-describedby="anchor-simplify-hint"
          onChange={(e) => update({ simplify: Number(e.target.value) })}
        />
        <p id="anchor-simplify-hint" className="field-hint">
          Ramer–Douglas–Peucker: removes vertices that lie within this distance of the simplified outline
          {reductionOn ? emPercent(params.simplify, unitsPerEm) : ''}. Larger values remove more points and can erase
          small details, corners, and thin features. 0 turns it off.
        </p>
      </div>

      <button
        type="button"
        className="button-small"
        disabled={disabled || (!spacingOn && !reductionOn)}
        onClick={() => update({ spacing: 0, simplify: 0 })}
      >
        Reset anchors
      </button>

      {stats && (
        <dl className="pipeline-steps" aria-live="polite" aria-busy={pending}>
          <Step label="Flattened" value={stats.flattenedVertices} active />
          <Step label="Spacing" value={stats.spacingApplied ? stats.spacedVertices : 'off'} active={stats.spacingApplied} />
          <Step label="Reduction" value={stats.reductionApplied ? stats.finalVertices : 'off'} active={stats.reductionApplied} />
        </dl>
      )}
      {stats?.reductionApplied && (
        <p className="field-hint">
          Largest distance from a removed vertex to the outline: {stats.reductionMaxDeviation.toFixed(2)} u.
        </p>
      )}
      {spacingOn && reductionOn && (
        <p className="font-warning">
          Spacing points lie on straight edges, so reduction removes them again. Use one or the other to see its
          effect.
        </p>
      )}
      {stats?.spacingSkipped && (
        <p className="font-warning">
          Spacing was skipped: it would create more than {ANCHOR_LIMITS.maxVertices.toLocaleString('en-US')} vertices.
          Increase the spacing.
        </p>
      )}
      {stats && stats.selfCrossingContours > 0 && (
        <p className="field-hint">
          {stats.selfCrossingContours === 1
            ? '1 contour already crosses itself in the font.'
            : `${stats.selfCrossingContours} contours already cross themselves in the font.`}{' '}
          Reduction keeps those crossings but does not add new ones.
        </p>
      )}
      {stats && stats.reductionFallbacks > 0 && (
        <p className="font-warning">
          {stats.reductionFallbacks} contour{stats.reductionFallbacks === 1 ? '' : 's'} could not be reduced safely (the
          result collapsed, flipped direction, or added self-crossings) and {stats.reductionFallbacks === 1 ? 'keeps' : 'keep'}{' '}
          {stats.reductionFallbacks === 1 ? 'its' : 'their'} unreduced points.
        </p>
      )}
    </fieldset>
  )
}
