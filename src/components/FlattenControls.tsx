import type { Dispatch } from 'react'
import type { FlattenStats } from '../geometry/flatten'
import type { FlattenMode, FlattenParams } from '../geometry/types'
import type { Action } from '../state/editorState'

interface FlattenControlsProps {
  params: FlattenParams
  stats: FlattenStats | null
  unitsPerEm: number | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

const modes: [FlattenMode, string][] = [
  ['adaptive', 'Adaptive'],
  ['segments', 'Fixed segments'],
]

// Tolerance slider is logarithmic: 0.1 to 100 font units.
const TOL_MIN = 0.1
const TOL_MAX = 100
const toSlider = (tol: number) => (100 * Math.log(tol / TOL_MIN)) / Math.log(TOL_MAX / TOL_MIN)
const fromSlider = (pos: number) => roundTolerance(TOL_MIN * Math.pow(TOL_MAX / TOL_MIN, pos / 100))

function roundTolerance(tol: number): number {
  if (tol < 1) return Math.round(tol * 100) / 100
  if (tol < 10) return Math.round(tol * 10) / 10
  return Math.round(tol)
}

function formatUnits(value: number): string {
  return value < 10 ? value.toFixed(2) : value.toFixed(1)
}

/** Fixed mode warns when the measured deviation exceeds 1% of the em. */
const WARN_FRACTION = 0.01

export default function FlattenControls({ params, stats, unitsPerEm, pending, disabled, dispatch }: FlattenControlsProps) {
  const update = (patch: Partial<FlattenParams>) => dispatch({ type: 'updateParams', group: 'flatten', patch })
  const emPercent = unitsPerEm ? ((params.tolerance / unitsPerEm) * 100).toFixed(2) : null
  const warnLimit = unitsPerEm ? unitsPerEm * WARN_FRACTION : null
  const showWarning =
    params.mode === 'segments' && stats && warnLimit !== null && stats.maxDeviation > warnLimit

  return (
    <fieldset className="group flatten" disabled={disabled}>
      <legend>Curve flattening</legend>

      <div className="field">
        <span className="field-label" id="flatten-mode-label">
          Mode
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="flatten-mode-label">
          {modes.map(([mode, label]) => (
            <label key={mode} className="segment-option">
              <input
                type="radio"
                name="flatten-mode"
                value={mode}
                checked={params.mode === mode}
                onChange={() => update({ mode })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {params.mode === 'adaptive' ? (
        <div className="field">
          <div className="field-head">
            <label htmlFor="flatten-tolerance">Tolerance</label>
            <output htmlFor="flatten-tolerance">
              {params.tolerance}
              <span className="unit">u</span>
            </output>
          </div>
          <input
            id="flatten-tolerance"
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={toSlider(params.tolerance)}
            aria-valuetext={`${params.tolerance} font units`}
            aria-describedby="flatten-tolerance-hint"
            onChange={(e) => update({ tolerance: fromSlider(Number(e.target.value)) })}
          />
          <p id="flatten-tolerance-hint" className="field-hint">
            Maximum distance between a curve and its straight edges, in font units
            {emPercent ? ` (${emPercent}% of the em)` : ''}. Smaller values follow the curve more closely and add
            vertices; sharper bends get more edges.
          </p>
        </div>
      ) : (
        <div className="field">
          <div className="field-head">
            <label htmlFor="flatten-segments">Segments per curve</label>
            <output htmlFor="flatten-segments">{params.segmentsPerCurve}</output>
          </div>
          <input
            id="flatten-segments"
            type="range"
            min={1}
            max={32}
            step={1}
            value={params.segmentsPerCurve}
            aria-describedby="flatten-segments-hint"
            onChange={(e) => update({ segmentsPerCurve: Number(e.target.value) })}
          />
          <p id="flatten-segments-hint" className="field-hint">
            Every quadratic or cubic curve becomes this many straight edges, sampled at equal steps of t. More segments
            give a finer approximation. Straight segments are kept as they are.
          </p>
        </div>
      )}

      {stats && (
        <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
          <div>
            <dt>Flattened</dt>
            <dd>{stats.vertexCount}</dd>
          </div>
          <div>
            <dt>Curves</dt>
            <dd>{stats.curveCount}</dd>
          </div>
          <div>
            <dt>Max deviation</dt>
            <dd>
              {formatUnits(stats.maxDeviation)}
              <span className="unit">u</span>
            </dd>
          </div>
        </dl>
      )}
      {stats && (
        <p className="field-hint">
          Deviation is measured at the middle of each edge, in font units; it does not change with canvas zoom.
          {pending ? ' Updating…' : ''}
        </p>
      )}
      {showWarning && (
        <p className="font-warning">
          Some edges stray more than 1% of the em from the curve. Add segments or switch to Adaptive.
        </p>
      )}
      {stats && stats.limitedCurves > 0 && (
        <p className="font-warning">
          {stats.limitedCurves} curve{stats.limitedCurves === 1 ? '' : 's'} hit the subdivision limit before reaching
          the tolerance.
        </p>
      )}
      {stats && stats.droppedContours > 0 && (
        <p className="font-warning">
          {stats.droppedContours} contour{stats.droppedContours === 1 ? '' : 's'} collapsed to fewer than three points
          and {stats.droppedContours === 1 ? 'is' : 'are'} omitted.
        </p>
      )}
    </fieldset>
  )
}
