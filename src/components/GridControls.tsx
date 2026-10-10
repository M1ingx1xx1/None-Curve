import type { Dispatch } from 'react'
import { ANGLE_STEPS, type ConstraintStats, type FallbackReason } from '../geometry/constraints'
import type { GridParams } from '../geometry/types'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'
import Icon from './Icon'

interface GridControlsProps {
  params: GridParams
  stats: ConstraintStats | null
  unitsPerEm: number | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

const GRID_MAX = 200
export const DEFAULT_GRID: GridParams = { snap: false, size: 10, angleLock: false, angleStep: 45 }

const stepLabels: Record<number, string> = {
  90: '90° — horizontal and vertical',
  45: '45° — adds diagonals',
  30: '30°',
  15: '15°',
}

const reasonText: Record<FallbackReason, string> = {
  collapsed: 'collapsed to fewer than three points or zero area',
  flipped: 'reversed its direction',
  crossings: 'would add self-crossings',
  contours: 'would move across another contour',
  unsolvable: 'has no closed shape with the allowed directions',
  moved: 'would change its shape too much',
}

function allowedAngles(step: number): string {
  const angles = Array.from({ length: 360 / step }, (_, i) => `${i * step}°`)
  return angles.length > 8 ? `${angles.slice(0, 4).join(', ')}, … ${angles[angles.length - 1]}` : angles.join(', ')
}

function describeFallbacks(stats: ConstraintStats, step: 'snap' | 'angle'): string | null {
  const items = stats.fallbacks.filter((f) => f.step === step)
  if (items.length === 0) return null
  const counts = new Map<FallbackReason, number>()
  for (const f of items) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1)
  const parts = [...counts].map(([reason, n]) => `${n} ${n === 1 ? 'contour' : 'contours'} ${reasonText[reason]}`)
  return parts.join('; ')
}

export default function GridControls({ params, stats, unitsPerEm, pending, disabled, dispatch }: GridControlsProps) {
  const update = (patch: Partial<GridParams>) => dispatch({ type: 'updateParams', group: 'grid', patch })
  const snapOn = params.snap && params.size > 0
  const snapFallback = stats ? describeFallbacks(stats, 'snap') : null
  const angleFallback = stats ? describeFallbacks(stats, 'angle') : null
  const simplifiedSnap = stats?.simplified.filter((s) => s.step === 'snap').length ?? 0
  const simplifiedAngle = stats?.simplified.filter((s) => s.step === 'angle').length ?? 0
  const introHint = useHint()
  const angleHint = useHint()
  const isDefault =
    params.snap === DEFAULT_GRID.snap &&
    params.size === DEFAULT_GRID.size &&
    params.angleLock === DEFAULT_GRID.angleLock &&
    params.angleStep === DEFAULT_GRID.angleStep

  return (
    <fieldset className="group grid-controls" disabled={disabled}>
      <legend>
        Grid &amp; angles <HintButton hint={introHint} topic="Grid and angles" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Runs after anchor reduction: Grid snapping → Angle lock. Turning a step off restores the result of the steps
          before it.
        </HintText>

        <div className="field field-toggle">
          <input id="grid-snap" type="checkbox" checked={params.snap} onChange={(e) => update({ snap: e.target.checked })} />
          <label htmlFor="grid-snap">Snap to grid</label>
        </div>
        <div className="field">
          <div className="field-head">
            <span className="field-title">
              <label htmlFor="grid-size">Grid size</label>

            </span>
            <output htmlFor="grid-size">
              {params.size > 0 ? params.size : 'Off'}
              {params.size > 0 && <span className="unit">u</span>}
            </output>
          </div>
          <input
            id="grid-size"
            type="range"
            min={0}
            max={GRID_MAX}
            step={1}
            value={params.size}
            disabled={!params.snap}
            aria-valuetext={params.size > 0 ? `${params.size} font units` : 'Off'}
            onChange={(e) => update({ size: Number(e.target.value) })}
          />
        </div>
        {stats?.snapApplied && (
          <p className="field-hint">
            Largest move {stats.snapMaxShift.toFixed(2)} u · {stats.snapMerged} merged{' '}
            {stats.snapMerged === 1 ? 'vertex' : 'vertices'}.
          </p>
        )}
        {simplifiedSnap > 0 && (
          <p className="field-hint">
            {simplifiedSnap} contour{simplifiedSnap === 1 ? ' was' : 's were'} simplified first so snapping could apply
            without collapsing or crossing.
          </p>
        )}
        {snapFallback && <p className="font-warning">Snapping skipped for: {snapFallback}. Those contours keep their unsnapped points.</p>}

        <div className="field field-toggle">
          <input
            id="angle-lock"
            type="checkbox"
            checked={params.angleLock}
            onChange={(e) => update({ angleLock: e.target.checked })}
          />
          <label htmlFor="angle-lock">Angle lock</label>
        </div>
        <div className="field">
          <span className="field-title">
            <label htmlFor="angle-step">Allowed directions</label>
            <HintButton hint={angleHint} topic="Allowed directions" />
          </span>
          <select
            id="angle-step"
            value={params.angleStep}
            disabled={!params.angleLock}
            aria-describedby={angleHint.id}
            onChange={(e) => update({ angleStep: Number(e.target.value) })}
          >
            {ANGLE_STEPS.map((step) => (
              <option key={step} value={step}>
                {stepLabels[step]}
              </option>
            ))}
          </select>
          <HintText hint={angleHint}>
            Edges turn to the nearest of {allowedAngles(params.angleStep)}, measured counter-clockwise from horizontal; an
            exact tie picks the counter-clockwise angle. Edge lengths are then adjusted, in proportion to their length,
            so the contour closes again, and it is fitted back to its original size and place. Where that would change
            the letter too much, its edges become fine stair steps instead.
          </HintText>
        </div>
        {stats?.angleApplied && <p className="field-hint">Largest move {stats.angleMaxShift.toFixed(2)} u.</p>}
        {simplifiedAngle > 0 && (
          <p className="field-hint">
            {simplifiedAngle} contour{simplifiedAngle === 1 ? ' needed' : 's needed'} a coarser outline or stair steps
            to lock their angles without crossing or changing the letter too much.
          </p>
        )}
        {angleFallback && (
          <p className="font-warning">Angle lock skipped for: {angleFallback}. Those contours keep their previous points.</p>
        )}

        {snapOn && params.angleLock && (
          <p className="font-warning">
            Angle lock runs after snapping and adjusts edge lengths, so some vertices move off the grid.
          </p>
        )}

        <button type="button" className="button-small" disabled={disabled || isDefault} onClick={() => update(DEFAULT_GRID)}>
          <Icon name="reset" />
          Reset grid &amp; angles
        </button>
      </div>
    </fieldset>
  )
}
