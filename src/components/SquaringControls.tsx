import type { Dispatch } from 'react'
import type { SquaringParams, SquaringScope, SquaringStats } from '../geometry/squaring'
import type { Action } from '../state/editorState'

interface SquaringControlsProps {
  params: SquaringParams
  stats: SquaringStats | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

const presets: [string, number][] = [
  ['Off', 0],
  ['Soft', 0.5],
  ['Square', 1],
]

const scopes: [SquaringScope, string][] = [
  ['round', 'Round contours'],
  ['all', 'All contours'],
]

const reasonText = {
  collapsed: 'collapsed',
  flipped: 'reversed direction',
  crossings: 'crossed itself',
} as const

export default function SquaringControls({ params, stats, pending, disabled, dispatch }: SquaringControlsProps) {
  const update = (patch: Partial<SquaringParams>) => dispatch({ type: 'updateParams', group: 'squaring', patch })
  const percent = Math.round(params.amount * 100)

  return (
    <fieldset className="group squaring" disabled={disabled}>
      <legend>Squaring</legend>
      <p className="field-hint">
        Deliberately reshapes round contours toward their bounding rectangle — at 100% a round O and its counter
        become squares. This changes the letterform on purpose. Runs right after flattening.
      </p>

      <div className="field">
        <div className="field-head">
          <label htmlFor="squaring-amount">Amount</label>
          <output htmlFor="squaring-amount">{percent > 0 ? `${percent}%` : 'Off'}</output>
        </div>
        <input
          id="squaring-amount"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={params.amount}
          aria-valuetext={percent > 0 ? `${percent} percent` : 'Off'}
          aria-describedby="squaring-amount-hint"
          onChange={(e) => update({ amount: Number(e.target.value) })}
        />
        <div className="preset-row" role="group" aria-label="Squaring presets">
          {presets.map(([label, value]) => (
            <button
              key={label}
              type="button"
              className="button-small"
              aria-pressed={params.amount === value}
              onClick={() => update({ amount: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p id="squaring-amount-hint" className="field-hint">
          Each point moves from the contour’s box centre toward the edge of its bounding box: 0% keeps the curve, 100%
          puts every point on the box. Each counter uses its own box, so stems keep their thickness at the side
          midpoints. Measured in each contour’s own box, so it does not depend on zoom. Add anchor reduction to clean up
          the straight sides.
        </p>
      </div>

      <div className="field">
        <span className="field-label" id="squaring-scope-label">
          Applies to
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="squaring-scope-label">
          {scopes.map(([scope, label]) => (
            <label key={scope} className="segment-option">
              <input
                type="radio"
                name="squaring-scope"
                value={scope}
                checked={params.scope === scope}
                onChange={() => update({ scope })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="field-hint">
          {params.scope === 'round'
            ? 'Only contours close to an ellipse (O, o, 0, bowls and counters) are squared; somewhat round ones are squared partly; stems, triangles, and S-curves stay as they are.'
            : 'Every contour is pushed toward its bounding rectangle. Non-round shapes can distort strongly; contours that would reverse or cross themselves keep their previous shape.'}
        </p>
      </div>

      {stats?.applied && (
        <p className="field-hint" aria-live="polite" aria-busy={pending}>
          {stats.squared} squared · {stats.partial} partly · {stats.notRound} not round (unchanged)
        </p>
      )}
      {stats && stats.fallbacks.length > 0 && (
        <p className="font-warning">
          {stats.fallbacks.length} contour{stats.fallbacks.length === 1 ? '' : 's'} kept the previous shape because squaring{' '}
          {[...new Set(stats.fallbacks.map((f) => reasonText[f.reason]))].join(' or ')} it.
        </p>
      )}
    </fieldset>
  )
}
