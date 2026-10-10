import type { Dispatch } from 'react'
import type { BreakRule } from '../geometry/curveRuns'
import type { FlattenStats } from '../geometry/flatten'
import type { FlattenMode, FlattenParams } from '../geometry/types'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'

interface FlattenControlsProps {
  params: FlattenParams
  stats: FlattenStats | null
  unitsPerEm: number | null
  pending: boolean
  disabled: boolean
  /** Random anchors replace Flatten's polygon, so these settings have no visible effect. */
  replacedByRandom: boolean
  dispatch: Dispatch<Action>
}

const breakRules: [BreakRule, string][] = [
  ['extrema', 'Corners & extremes'],
  ['corners', 'Corners only'],
]

const modes: [FlattenMode, string][] = [
  ['adaptive', 'Adaptive'],
  ['segments', 'Fixed segments'],
]

// Tolerance slider is logarithmic: 0.1 to 500 font units. The top of the range only matters with
// Merge joined curves, where a whole bowl can become a single edge.
const TOL_MIN = 0.1
const TOL_MAX = 500
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

export default function FlattenControls({
  params,
  stats: flattenStats,
  unitsPerEm,
  pending,
  disabled,
  replacedByRandom,
  dispatch,
}: FlattenControlsProps) {
  const update = (patch: Partial<FlattenParams>) => dispatch({ type: 'updateParams', group: 'flatten', patch })
  // While random anchors replace the polygon, Flatten's statistics describe a shape that is not shown.
  const stats = replacedByRandom ? null : flattenStats
  const toleranceHint = useHint()
  const mergeHint = useHint()
  const breakHint = useHint()
  const mergeLinesHint = useHint()
  const cornerHint = useHint()
  const emPercent = unitsPerEm ? ((params.tolerance / unitsPerEm) * 100).toFixed(2) : null
  const warnLimit = unitsPerEm ? unitsPerEm * WARN_FRACTION : null
  // Merging is coarse on purpose, so the "too far from the curve" warning only applies without it.
  const showWarning =
    params.mode === 'segments' && !params.mergeCurves && stats && warnLimit !== null && stats.maxDeviation > warnLimit

  return (
    <fieldset className="group flatten" disabled={disabled || replacedByRandom}>
      <legend>Curve flattening</legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        {replacedByRandom && (
          <p className="group-replaced" role="note">
            Random anchors (at the bottom) are on and replace flattening, so these settings do not change the letters.
            Turn Random anchors off to use them.
          </p>
        )}

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
              <span className="field-title">
                <label htmlFor="flatten-tolerance">Tolerance</label>
                <HintButton hint={toleranceHint} topic="Tolerance" />
              </span>
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
              aria-describedby={toleranceHint.id}
              onChange={(e) => update({ tolerance: fromSlider(Number(e.target.value)) })}
            />
            <HintText hint={toleranceHint}>
              Maximum distance between a curve and its straight edges, in font units
              {emPercent ? ` (${emPercent}% of the em)` : ''}. Smaller values follow the curve more closely and add
              vertices; sharper bends get more edges.
              {params.mergeCurves
                ? ' With Merge joined curves, it applies to each whole merged curve, so large values reduce a bowl to a few edges.'
                : ' Each font curve keeps at least one edge, so large values only go so far — turn on Merge joined curves for coarser shapes.'}
            </HintText>
          </div>
        ) : (
          <div className="field">
            <div className="field-head">
              <span className="field-title">
                <label htmlFor="flatten-segments">Segments per curve</label>

              </span>
              <output htmlFor="flatten-segments">{params.segmentsPerCurve}</output>
            </div>
            <input
              id="flatten-segments"
              type="range"
              min={1}
              max={32}
              step={1}
              value={params.segmentsPerCurve}
              onChange={(e) => update({ segmentsPerCurve: Number(e.target.value) })}
            />
          </div>
        )}

        <div className="merge-controls">
          <div className="field field-toggle">
            <input
              id="flatten-merge"
              type="checkbox"
              checked={params.mergeCurves}
              aria-describedby={mergeHint.id}
              onChange={(e) => update({ mergeCurves: e.target.checked })}
            />
            <span className="field-title">
              <label htmlFor="flatten-merge">Merge joined curves</label>
              <HintButton hint={mergeHint} topic="Merge joined curves" />
            </span>
          </div>
          <HintText hint={mergeHint}>
            {params.mode === 'segments'
              ? 'Fonts build one visible curve from several smaller curves, so even 1–2 segments per curve can still look smooth. Merging treats curves that join smoothly as one curve, so the setting above applies to the whole visible curve.'
              : 'Fonts build one visible curve from several smaller curves, and each keeps at least one edge, so even a large tolerance can still look smooth. Merging treats curves that join smoothly as one curve, so the tolerance applies to the whole visible curve.'}{' '}
            Shared by both modes.
          </HintText>
          {params.mergeCurves && (
            <>
              <div className="field">
                <span className="field-title">
                  <span className="field-label" id="flatten-break-label">
                    Break merged curves at
                  </span>
                  <HintButton hint={breakHint} topic="Break merged curves at" />
                </span>
                <div className="segmented" role="radiogroup" aria-labelledby="flatten-break-label">
                  {breakRules.map(([rule, label]) => (
                    <label key={rule} className="segment-option">
                      <input
                        type="radio"
                        name="flatten-break"
                        value={rule}
                        checked={params.breakAt === rule}
                        onChange={() => update({ breakAt: rule })}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <HintText hint={breakHint}>
                  {params.breakAt === 'extrema'
                    ? 'Breaks at corners and at the leftmost, rightmost, top, and bottom points of each curve, so a round bowl splits into quarter arcs.'
                    : 'Breaks only at corners and straight segments. Whole smooth loops (like O) become one curve and use at least 3 edges.'}{' '}
                  Merged curves also break at the contour start, so the start point is kept.
                </HintText>
              </div>
              <div className="field field-toggle">
                <input
                  id="flatten-merge-lines"
                  type="checkbox"
                  checked={params.mergeLines}
                  aria-describedby={mergeLinesHint.id}
                  onChange={(e) => update({ mergeLines: e.target.checked })}
                />
                <span className="field-title">
                  <label htmlFor="flatten-merge-lines">Merge through straight lines</label>
                  <HintButton hint={mergeLinesHint} topic="Merge through straight lines" />
                </span>
              </div>
              <HintText hint={mergeLinesHint}>
                Also merges straight segments that flow smoothly into a curve — like the stems of n, m, and u running
                into their arches, or the straight sides of some O shapes — so they are resampled together. This changes
                letters a lot: stems can lose their ends and corners can be cut. Off by default.
              </HintText>
              <div className="field">
                <div className="field-head">
                  <span className="field-title">
                    <label htmlFor="flatten-corner">Corner angle</label>
                    <HintButton hint={cornerHint} topic="Corner angle" />
                  </span>
                  <output htmlFor="flatten-corner">
                    {params.cornerAngle}
                    <span className="unit">°</span>
                  </output>
                </div>
                <input
                  id="flatten-corner"
                  type="range"
                  min={1}
                  max={90}
                  step={1}
                  value={params.cornerAngle}
                  aria-valuetext={`${params.cornerAngle} degrees`}
                  aria-describedby={cornerHint.id}
                  onChange={(e) => update({ cornerAngle: Number(e.target.value) })}
                />
                <HintText hint={cornerHint}>
                  Joints that turn by more than this are corners and always break; gentler joints are merged.
                  {params.mergeLines
                    ? ' With Merge through straight lines, this decides which line-to-curve and line-to-line joints merge, so larger values give a much coarser, lower-resolution outline.'
                    : ' Without Merge through straight lines it only affects joints between two curves, which in most fonts are already smooth — so it rarely changes anything. Turn on Merge through straight lines to make it effective.'}
                </HintText>
              </div>
            </>
          )}
        </div>

        {stats && (
          <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
            <div>
              <dt>Flattened</dt>
              <dd>{stats.vertexCount}</dd>
            </div>
            <div>
              <dt>Curves</dt>
              <dd>
                {stats.curveCount}
                {stats.mergedCurveCount !== null && ` → ${stats.mergedCurveCount}`}
              </dd>
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
        {stats && pending && <p className="field-hint">Updating…</p>}
        {showWarning && (
          <p className="font-warning">
            Some edges stray more than 1% of the em from the curve. Add segments or switch to Adaptive.
          </p>
        )}
        {stats && stats.mergeFallbacks > 0 && (
          <p className="font-warning">
            {stats.mergeFallbacks} contour{stats.mergeFallbacks === 1 ? '' : 's'} would collapse, flip, or cross
            {stats.mergeFallbacks === 1 ? ' itself' : ' themselves'} or another contour when merged, so{' '}
            {stats.mergeFallbacks === 1 ? 'it uses' : 'they use'} the unmerged result. Try breaking at extrema or adding
            segments.
          </p>
        )}
        {stats && stats.refinedCurves > 0 && (
          <p className="field-hint">
            {stats.refinedCurves} curve{stats.refinedCurves === 1 ? ' is' : 's are'} flattened more finely than set, so
            the outline does not cross itself or another contour.
          </p>
        )}
        {stats && stats.unresolvedContours > 0 && (
          <p className="font-warning">
            {stats.unresolvedContours} contour{stats.unresolvedContours === 1 ? ' still crosses' : 's still cross'} where
            the original does not, even at the finest flattening tried.
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
            {stats.droppedContours} contour{stats.droppedContours === 1 ? ' has' : 's have'} no area (fewer than three
            points, or all in a line) and {stats.droppedContours === 1 ? 'is' : 'are'} omitted.
          </p>
        )}
      </div>
    </fieldset>
  )
}
