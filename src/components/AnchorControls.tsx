import { memo, type Dispatch } from 'react'
import { ANCHOR_LIMITS, type AnchorStats } from '../geometry/anchors'
import type { AnchorParams } from '../geometry/types'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'
import Icon from './Icon'
import SliderField from './SliderField'
import { sameControlProps } from './sameControlProps'

interface AnchorControlsProps {
  params: AnchorParams
  stats: AnchorStats | null
  unitsPerEm: number | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

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

function AnchorControls({ params, stats, unitsPerEm, pending, disabled, dispatch }: AnchorControlsProps) {
  const update = (patch: Partial<AnchorParams>) => dispatch({ type: 'updateParams', group: 'anchors', patch })
  const spacingOn = params.spacing > 0
  const reductionOn = params.simplify > 0
  const introHint = useHint()

  return (
    <fieldset className="group anchors" disabled={disabled}>
      <legend>
        Anchors <HintButton hint={introHint} topic="Anchors" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Runs after flattening, in a fixed order: Flatten → Spacing → Reduction. Each change is recomputed from the
          original curves.
        </HintText>

        <SliderField
          id="anchor-spacing"
          target="anchors.spacing"
          label="Anchor spacing"
          value={params.spacing}
          unit="u"
          valueText={spacingOn ? `${params.spacing} font units` : 'Off'}
          hint={
            <>
              Splits every polygon edge so no edge is longer than this{spacingOn ? emPercent(params.spacing, unitsPerEm) : ''}.
              New points sit on the existing edges, so the shape does not change. 0 turns it off.
            </>
          }
          onChange={(spacing) => update({ spacing })}
        />

        <SliderField
          id="anchor-simplify"
          target="anchors.simplify"
          label="Anchor reduction"
          value={params.simplify}
          unit="u"
          valueText={reductionOn ? `${params.simplify} font units` : 'Off'}
          hint={
            <>
              Ramer–Douglas–Peucker: removes vertices that lie within this distance of the simplified outline
              {reductionOn ? emPercent(params.simplify, unitsPerEm) : ''}. Larger values remove more points and can erase
              small details, corners, and thin features. 0 turns it off.
            </>
          }
          onChange={(simplify) => update({ simplify })}
        />

        <button
          type="button"
          className="button-small"
          disabled={disabled || (!spacingOn && !reductionOn)}
          onClick={() => update({ spacing: 0, simplify: 0 })}
        >
          <Icon name="reset" />
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
            result collapsed, flipped direction, crossed itself, or moved across another contour) and {stats.reductionFallbacks === 1 ? 'keeps' : 'keep'}{' '}
            {stats.reductionFallbacks === 1 ? 'its' : 'their'} unreduced points.
          </p>
        )}
      </div>
    </fieldset>
  )
}

// Live frames re-render the panel; a group skips them unless its own props or statistics change.
export default memo(AnchorControls, sameControlProps)
