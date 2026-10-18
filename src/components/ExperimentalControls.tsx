import { memo, type Dispatch, type ReactNode } from 'react'
import { EXPERIMENTAL_LIMITS, experimentalMerges, type ExperimentalStats } from '../geometry/experimental'
import type { DissolveStats } from '../geometry/dissolve'
import type { SlipstreamStats } from '../geometry/slipstream'
import { BURST_REACH, THORN_LIMITS, type ThornStats } from '../geometry/thorn'
import type { CrumpleParams, DissolveParams, ExperimentalParams, RippleParams, SlipstreamParams, ThornParams, WhorlParams } from '../geometry/types'
import type { WarpStats } from '../geometry/warp'
import { clearedExperimental, isClearedExperimental } from '../state/clearExperimental'
import { initialState, type Action } from '../state/editorState'
import { reachFromSlider, reachPercent, reachToSlider, SLIDER_RANGES, THORN_REACH, type SliderId, type SliderRange } from '../state/sliderScales'
import { HintButton, HintText, useHint, type HintState } from './Hint'
import Icon from './Icon'
import LiveMarker from './LiveMarker'
import LiveSeed from './LiveSeed'
import { LiveSwitch } from './LiveValue'
import SliderNumber from './SliderNumber'
import { sameControlProps } from './sameControlProps'

interface ExperimentalControlsProps {
  params: ExperimentalParams
  stats: ExperimentalStats | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
  /** Which glyph the statistics describe, shown in the intro like on the Geometry tab. */
  statistics?: ReactNode
  /** How far a thorn can reach at Reach 100% (em): the canvas diagonal at the current text size, up to Thorn's cap. */
  reachEm: number
}

/** The starting Experimental settings, for older settings missing an effect or field. */
export const DEFAULT_EXPERIMENTAL: ExperimentalParams = initialState.params.experimental

const percent = (v: number) => Math.round(v * 100)
/** Ems for a hint: one decimal below 10, whole above. */
const ems = (v: number) => (Math.round(v * 10) < 100 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)))

// Reach is cubic (THORN_REACH): short thorns keep fine steps, and the top flings anchors across the whole canvas.
// Its number box takes the reach itself, to roundReach's unit.
const REACH_CURVE: SliderCurve = {
  slider: THORN_REACH.slider,
  toSlider: reachToSlider,
  fromSlider: reachFromSlider,
  value: { min: 0, max: THORN_REACH.max, step: THORN_REACH.step },
}

/**
 * The Experimental tab: effects that run after the whole Geometry pipeline and can all be on at once.
 * Each folds the letter along straight creases, so it adds corners but never curves. Beyond 100% an
 * effect folds the letter onto itself, and the overlaps are merged into one outline.
 */
function ExperimentalControls({ params, stats, pending, disabled, dispatch, statistics, reachEm }: ExperimentalControlsProps) {
  const update = (patch: Partial<ExperimentalParams>) => dispatch({ type: 'updateParams', group: 'experimental', patch })
  const introHint = useHint()
  const seedHint = useHint()
  // Reset clears every effect but keeps the seed, so a variant the user liked is not lost.
  const isCleared = isClearedExperimental(params)

  return (
    <>
      <div className="panel-notice panel-intro">
        <p className="field-title">
          <span>Runs after Geometry: Crumple → Ripple → Whorl → Slipstream → Thorn → Dissolve. Effects can be on together.</span>
          <HintButton hint={introHint} topic="Experimental effects" />
        </p>
        {statistics}
        <HintText hint={introHint}>
          Each effect folds the letters along straight creases, so it adds corners but never curves. Up to 100%, any
          combination keeps every letter as it was arranged. Beyond that, parts of a letter fold over other parts; the
          overlaps are merged into one clean outline, so the letters still export. Slipstream’s cuts and Thorn’s thorns
          are merged the same way. Dissolve redraws the result as straight-edged islands of ink. Where several dense
          effects together would add too many vertices, the letter is simplified, so it stays quick to draw and export.
          Statistics are for the selected glyph.
        </HintText>
        {(experimentalMerges(params) || stats?.budget.applied) && <FoldStats stats={stats} pending={pending} />}
      </div>

      <CrumpleGroup params={params.crumple} stats={stats?.crumple ?? null} pending={pending} disabled={disabled} onChange={(crumple) => update({ crumple })} />
      <RippleGroup params={params.ripple} stats={stats?.ripple ?? null} pending={pending} disabled={disabled} onChange={(ripple) => update({ ripple })} />
      <WhorlGroup params={params.whorl} stats={stats?.whorl ?? null} pending={pending} disabled={disabled} onChange={(whorl) => update({ whorl })} />
      <SlipstreamGroup params={params.slipstream} stats={stats?.slipstream ?? null} pending={pending} disabled={disabled} onChange={(slipstream) => update({ slipstream })} />
      <ThornGroup
        params={params.thorn ?? DEFAULT_EXPERIMENTAL.thorn}
        stats={stats?.thorn ?? null}
        pending={pending}
        disabled={disabled}
        reachEm={reachEm}
        onChange={(thorn) => update({ thorn })}
      />
      <DissolveGroup
        params={params.dissolve ?? DEFAULT_EXPERIMENTAL.dissolve}
        stats={stats?.dissolve ?? null}
        pending={pending}
        disabled={disabled}
        onChange={(dissolve) => update({ dissolve })}
      />

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
              <LiveSeed target="experimental.seed" />
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
              Picks Crumple’s folds, Slipstream’s gusts, slips, cuts and trails, Thorn’s anchors and flutes, and Dissolve’s
              ink; Ripple and Whorl have no randomness. The same seed and settings always produce the same letters.
            </HintText>
          </div>

          <button
            type="button"
            className="button-small"
            disabled={disabled || isCleared}
            onClick={() => update(clearedExperimental(params.seed))}
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

function CrumpleGroup({ params, stats, pending, disabled, onChange }: GroupProps<CrumpleParams>) {
  const update = (patch: Partial<CrumpleParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const amountHint = useHint()
  const facetHint = useHint()
  const turnHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Crumple <HintButton hint={introHint} topic="Crumple" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Crumples the letters like paper: the plane is cut into triangles that each move a little, so the outline bends
          only along straight creases. Counters and the strokes around them fold together.
        </HintText>

        <div className="field field-toggle">
          <input id="crumple-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="crumple-enabled">Use crumple</label>
          <LiveSwitch target="experimental.crumple.enabled" />
        </div>

        <RangeField
          id="crumple-amount"
          target="experimental.crumple.amount"
          label="Amount"
          value={params.amount}
          scale={100}
          unit="%"
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          hint={amountHint}
          hintText="How far the folds move the outline. Above 100%, facets flip over their neighbours and the letter folds onto itself."
          onChange={(amount) => update({ amount })}
        />
        <RangeField
          id="crumple-facet"
          target="experimental.crumple.facet"
          label="Facet size"
          value={params.facet}
          scale={100}
          unit="% em"
          valueText={`${percent(params.facet)} percent of the em`}
          disabled={off}
          hint={facetHint}
          hintText="Size of the triangles, as a share of the em. Larger facets give fewer, bigger folds; the smallest still keeps creases far enough apart to read as corners."
          onChange={(facet) => update({ facet })}
        />
        <RangeField
          id="crumple-turn"
          target="experimental.crumple.turn"
          label="Turn"
          value={params.turn ?? 0}
          unit="°"
          valueText={`${Math.round(params.turn ?? 0)} degrees`}
          disabled={off}
          hint={turnHint}
          hintText="Turns the way every fold moves, keeping the creases where they are. At 180° the paper is crumpled the opposite way."
          onChange={(turn) => update({ turn })}
        />

        <EffectStats stats={stats} pending={pending} effect="crumple" />
      </div>
    </fieldset>
  )
}

function RippleGroup({ params, stats, pending, disabled, onChange }: GroupProps<RippleParams>) {
  const update = (patch: Partial<RippleParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const amountHint = useHint()
  const wavelengthHint = useHint()
  const centerHint = useHint()
  const fadeHint = useHint()
  const petalsHint = useHint()
  const reverseHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Ripple <HintButton hint={introHint} topic="Ripple" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Waves spread from a point as rings of straight-sided polygons. Each ring is pushed out or pulled in, in turn, so
          the outline zigzags where it crosses them. Runs after Crumple.
        </HintText>

        <div className="field field-toggle">
          <input id="ripple-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="ripple-enabled">Use ripple</label>
          <LiveSwitch target="experimental.ripple.enabled" />
        </div>

        <RangeField
          id="ripple-amount"
          target="experimental.ripple.amount"
          label="Amount"
          value={params.amount}
          scale={100}
          unit="%"
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          hint={amountHint}
          hintText="How far each ring moves. Above 100%, rings overtake each other and the letter folds onto itself."
          onChange={(amount) => update({ amount })}
        />
        <div className="field field-toggle">
          <input
            id="ripple-reverse"
            type="checkbox"
            checked={params.reverse === true}
            disabled={off}
            aria-describedby={reverseHint.id}
            onChange={(e) => update({ reverse: e.target.checked })}
          />
          <label htmlFor="ripple-reverse">Reverse</label>
          <HintButton hint={reverseHint} topic="Reverse" />
          <LiveSwitch target="experimental.ripple.reverse" />
        </div>
        <HintText hint={reverseHint}>
          Swaps out and in: rings that were pushed out are pulled in, and petals point at the middle of each side instead of
          the corners.
        </HintText>
        <RangeField
          id="ripple-wavelength"
          target="experimental.ripple.wavelength"
          label="Wavelength"
          value={params.wavelength}
          scale={100}
          unit="% em"
          valueText={`${percent(params.wavelength)} percent of the em`}
          disabled={off}
          hint={wavelengthHint}
          hintText="Distance from one crest to the next, as a share of the em. Rings fall half of it apart."
          onChange={(wavelength) => update({ wavelength })}
        />
        <RangeField
          id="ripple-sides"
          target="experimental.ripple.sides"
          label="Sides"
          value={params.sides}
          valueText={`${params.sides} sides`}
          disabled={off}
          onChange={(sides) => update({ sides })}
        />
        <RangeField
          id="ripple-center-x"
          target="experimental.ripple.centerX"
          label="Center X"
          value={params.centerX}
          scale={100}
          unit="%"
          valueText={`${percent(params.centerX)} percent across the letter`}
          disabled={off}
          hint={centerHint}
          hintText="Where the waves start, as a share of each letter’s width and height: 0% is the left or bottom edge, 100% the right or top. Values beyond put the center outside the letter."
          onChange={(centerX) => update({ centerX })}
        />
        <RangeField
          id="ripple-center-y"
          target="experimental.ripple.centerY"
          label="Center Y"
          value={params.centerY}
          scale={100}
          unit="%"
          valueText={`${percent(params.centerY)} percent up the letter`}
          disabled={off}
          onChange={(centerY) => update({ centerY })}
        />
        <RangeField
          id="ripple-fade"
          target="experimental.ripple.fade"
          label="Fade"
          value={params.fade}
          scale={100}
          unit="%"
          valueText={`${percent(params.fade)} percent`}
          disabled={off}
          hint={fadeHint}
          hintText="How much the waves die down away from the center. At 100% they are gone by the farthest point of the letter."
          onChange={(fade) => update({ fade })}
        />
        <RangeField
          id="ripple-petals"
          target="experimental.ripple.petals"
          label="Petals"
          value={params.petals ?? 0}
          scale={100}
          unit="%"
          valueText={`${percent(params.petals ?? 0)} percent`}
          disabled={off}
          hint={petalsHint}
          hintText="Bends every ring into a flower with straight-edged petals, one per side. Above 100% the petals keep growing; the notches between them stay put."
          onChange={(petals) => update({ petals })}
        />

        <EffectStats stats={stats} pending={pending} effect="ripple" />
      </div>
    </fieldset>
  )
}

function WhorlGroup({ params, stats, pending, disabled, onChange }: GroupProps<WhorlParams>) {
  const update = (patch: Partial<WhorlParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const amountHint = useHint()
  const pinHint = useHint()
  const ringsHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Whorl <HintButton hint={introHint} topic="Whorl" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Swirls each letter around its middle. The swirl is built from rings of straight-sided polygons that each turn as
          a whole, so strokes bend only along straight creases. Runs after Ripple.
        </HintText>

        <div className="field field-toggle">
          <input id="whorl-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="whorl-enabled">Use whorl</label>
          <LiveSwitch target="experimental.whorl.enabled" />
        </div>

        <RangeField
          id="whorl-amount"
          target="experimental.whorl.amount"
          label="Amount"
          value={params.amount}
          scale={100}
          unit="%"
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          hint={amountHint}
          hintText="How far the swirl turns; below 0% it turns clockwise. Above 100% either way, the rings turn past each other and the letter folds onto itself."
          onChange={(amount) => update({ amount })}
        />
        <div className="field field-toggle">
          <input
            id="whorl-pinned"
            type="checkbox"
            checked={params.pinned}
            disabled={off}
            aria-describedby={pinHint.id}
            onChange={(e) => update({ pinned: e.target.checked })}
          />
          <label htmlFor="whorl-pinned">Pin top and bottom</label>
          <HintButton hint={pinHint} topic="Pin top and bottom" />
        </div>
        <HintText hint={pinHint}>
          On: the top and bottom of the letter stay put and the middle turns. Off: the middle stays put and the outside
          turns, the top and bottom with it.
        </HintText>
        <RangeField
          id="whorl-rings"
          target="experimental.whorl.rings"
          label="Rings"
          value={params.rings}
          valueText={`${params.rings} rings`}
          disabled={off}
          hint={ringsHint}
          hintText="Rings from the middle of the letter to its top and bottom. Fewer rings give bigger, chunkier facets."
          onChange={(rings) => update({ rings })}
        />
        <RangeField
          id="whorl-sides"
          target="experimental.whorl.sides"
          label="Sides"
          value={params.sides}
          valueText={`${params.sides} sides`}
          disabled={off}
          onChange={(sides) => update({ sides })}
        />

        <EffectStats stats={stats} pending={pending} effect="whorl" />
      </div>
    </fieldset>
  )
}

function SlipstreamGroup({
  params,
  stats,
  pending,
  disabled,
  onChange,
}: Omit<GroupProps<SlipstreamParams>, 'stats'> & { stats: SlipstreamStats | null }) {
  const update = (patch: Partial<SlipstreamParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const directionHint = useHint()
  const strengthHint = useHint()
  const slipHint = useHint()
  const gustHint = useHint()
  const gustinessHint = useHint()
  const cutsHint = useHint()
  const trailsHint = useHint()
  // Older saved settings have no slip, cuts or trails: they show as 0, as the effect reads them.
  const slip = Number.isFinite(params.slip) ? params.slip : 0
  const cuts = Number.isFinite(params.cuts) ? params.cuts : 0
  const trails = Number.isFinite(params.trails) ? params.trails : 0

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Slipstream <HintButton hint={introHint} topic="Slipstream" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Letters caught in a stream. Bands across the stream slide past each other like slices, and the stream draws the
          letters out: the side facing it stays put, and gusts pull some bands further than others. Thin cuts run into the
          letters along the stream, and trails stream off their downwind side. Runs after Whorl.
        </HintText>

        <div className="field field-toggle">
          <input id="slipstream-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="slipstream-enabled">Use slipstream</label>
          <LiveSwitch target="experimental.slipstream.enabled" />
        </div>

        <RangeField
          id="slipstream-direction"
          target="experimental.slipstream.direction"
          label="Direction"
          value={params.direction}
          unit="°"
          valueText={`${Math.round(params.direction)} degrees`}
          disabled={off}
          hint={directionHint}
          hintText="Where the stream flows to: 0° to the right, 90° up, 180° to the left, 270° down. Slices, cuts and trails follow it."
          onChange={(direction) => update({ direction })}
        />
        <RangeField
          id="slipstream-strength"
          target="experimental.slipstream.strength"
          label="Strength"
          value={params.strength}
          scale={100}
          unit="%"
          valueText={`${percent(params.strength)} percent`}
          disabled={off}
          hint={strengthHint}
          hintText="How much longer the letters get in a full gust: at 100% a part of the letter is pulled as far again as it lies downwind of the edge facing the stream, at 800% eight times as far. Nothing moves more than 4 em. Stronger streams also draw longer trails."
          onChange={(strength) => update({ strength })}
        />
        <RangeField
          id="slipstream-slip"
          target="experimental.slipstream.slip"
          label="Slip"
          value={slip}
          scale={100}
          unit="% em"
          valueText={`${percent(slip)} percent of the em`}
          disabled={off}
          hint={slipHint}
          hintText="How far bands across the stream slide past each other along it, as a share of the em. Wide bands, a few gust sizes across, sway by up to this much; each gust-size band adds a small jolt of its own, so strokes break into offset slices with a few large steps and finer ones between. Slipping never folds the letter."
          onChange={(value) => update({ slip: value })}
        />
        <RangeField
          id="slipstream-gust"
          target="experimental.slipstream.gust"
          label="Gust size"
          value={params.gust}
          scale={100}
          unit="% em"
          valueText={`${percent(params.gust)} percent of the em`}
          disabled={off}
          hint={gustHint}
          hintText="Width of each band that a gust pulls or slides, as a share of the em. With a level stream, every letter on a line shares the same bands."
          onChange={(gust) => update({ gust })}
        />
        <RangeField
          id="slipstream-gustiness"
          target="experimental.slipstream.gustiness"
          label="Gustiness"
          value={params.gustiness}
          scale={100}
          unit="%"
          valueText={`${percent(params.gustiness)} percent`}
          disabled={off}
          hint={gustinessHint}
          hintText="How much the gusts differ from band to band. Above 100%, some gusts blow backwards and tear the letter."
          onChange={(gustiness) => update({ gustiness })}
        />
        <RangeField
          id="slipstream-cuts"
          target="experimental.slipstream.cuts"
          label="Cuts"
          value={cuts}
          valueText={`${cuts} ${cuts === 1 ? 'cut' : 'cuts'} per letter`}
          disabled={off}
          hint={cutsHint}
          hintText="Thin wedge-shaped slits per letter, along the stream. Each enters from the side facing the stream or the side away from it, widest where it enters, and tapers to a point inside a stroke; about one in four goes right through. The outline is redrawn around them."
          onChange={(value) => update({ cuts: value })}
        />
        <RangeField
          id="slipstream-trails"
          target="experimental.slipstream.trails"
          label="Trails"
          value={trails}
          valueText={`${trails} ${trails === 1 ? 'trail' : 'trails'} per letter`}
          disabled={off}
          hint={trailsHint}
          hintText="Thin streaks per letter, dragged downwind out of its outside edges that face away from the stream; Strength makes them longer. A trail that would run into the letter or another trail grows elsewhere or not at all, so letters can get fewer."
          onChange={(value) => update({ trails: value })}
        />

        <EffectStats stats={stats} pending={pending} effect="slipstream" />
        {stats?.applied && (cuts > 0 || trails > 0) && (
          <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
            <div>
              <dt>Cuts</dt>
              <dd>{stats.cuts}</dd>
            </div>
            <div>
              <dt>Trails</dt>
              <dd>{stats.trails}</dd>
            </div>
          </dl>
        )}
      </div>
    </fieldset>
  )
}

function ThornGroup({
  params,
  stats,
  pending,
  disabled,
  reachEm,
  onChange,
}: Omit<GroupProps<ThornParams>, 'stats'> & { stats: ThornStats | null; reachEm: number }) {
  const update = (patch: Partial<ThornParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  // Older saved settings lack the newer sliders.
  const root = params.root ?? DEFAULT_EXPERIMENTAL.thorn.root
  const refraction = params.refraction ?? 0
  const flute = params.flute ?? DEFAULT_EXPERIMENTAL.thorn.flute
  const burst = params.burst === true
  const spikes = params.spikes ?? DEFAULT_EXPERIMENTAL.thorn.spikes
  const dent = params.dent ?? DEFAULT_EXPERIMENTAL.thorn.dent
  const introHint = useHint()
  const burstHint = useHint()
  const dentHint = useHint()
  const countHint = useHint()
  const reachHint = useHint()
  const reverseHint = useHint()
  const rootHint = useHint()
  const spreadHint = useHint()
  const widthHint = useHint()
  const refractionHint = useHint()
  const fluteHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Thorn <HintButton hint={introHint} topic="Thorn" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          A few anchors on the outside of each letter jump out into the canvas as long, straight thorns and pull the letter
          along: strokes lean and thin, and counters bend toward the thorn. Refraction then shows the letter through fluted
          glass. The seed picks which anchors and where they go: Next variant, or Sound, makes them jump somewhere new.
          Burst instead grows many spikes all round each letter. Runs after Slipstream.
        </HintText>

        <div className="field field-toggle">
          <input id="thorn-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="thorn-enabled">Use thorn</label>
          <LiveSwitch target="experimental.thorn.enabled" />
        </div>
        <div className="field field-toggle">
          <input
            id="thorn-burst"
            type="checkbox"
            checked={burst}
            disabled={off}
            aria-describedby={burstHint.id}
            onChange={(e) => update({ burst: e.target.checked })}
          />
          <label htmlFor="thorn-burst">Burst</label>
          <HintButton hint={burstHint} topic="Burst" />
          <LiveSwitch target="experimental.thorn.burst" />
        </div>
        <HintText hint={burstHint}>
          The letter explodes: many straight spikes grow all round it, into its counters too, and the outline between them
          sinks into the strokes, so they look thin and broken. Anchors then counts spikes (up to{' '}
          {THORN_LIMITS.maxSpikes}), Dent sets how deep the outline sinks, and Root is not used.
        </HintText>

        {burst ? (
          <RangeField
            id="thorn-spikes"
            target="experimental.thorn.spikes"
            label="Anchors"
            value={spikes}
            valueText={`${spikes} spikes`}
            disabled={off}
            hint={countHint}
            hintText="How many spikes grow from each letter, spread evenly round all its outlines, counters included."
            onChange={(spikes) => update({ spikes })}
          />
        ) : (
          <RangeField
            id="thorn-count"
            target="experimental.thorn.count"
            label="Anchors"
            value={params.count}
            valueText={`${params.count} ${params.count === 1 ? 'anchor' : 'anchors'}`}
            disabled={off}
            hint={countHint}
            hintText="How many anchors of each letter jump."
            onChange={(count) => update({ count })}
          />
        )}
        <RangeField
          id="thorn-reach"
          target="experimental.thorn.canvasReach"
          curve={REACH_CURVE}
          label="Reach"
          value={params.canvasReach}
          scale={100}
          unit="% canvas"
          valueText={`${reachPercent(params.canvasReach)} percent of the canvas`}
          disabled={off}
          hint={reachHint}
          hintText={
            burst
              ? `How long the spikes are, as a share of the canvas diagonal: the longest is ${percent(BURST_REACH)}% of that share, most are much shorter. At this text size and canvas, 100% gives spikes up to about ${ems(reachEm * BURST_REACH)} em.`
              : `How far the anchors jump, as a share of the canvas diagonal: at 100% a thorn can cross the whole canvas. Each goes a random 35–100% of it. At this text size and canvas, 100% is about ${ems(reachEm)} em.`
          }
          onChange={(canvasReach) => update({ canvasReach })}
        />
        <div className="field field-toggle">
          <input
            id="thorn-reverse"
            type="checkbox"
            checked={params.reverse === true}
            disabled={off}
            aria-describedby={reverseHint.id}
            onChange={(e) => update({ reverse: e.target.checked })}
          />
          <label htmlFor="thorn-reverse">Reverse</label>
          <HintButton hint={reverseHint} topic="Reverse" />
          <LiveSwitch target="experimental.thorn.reverse" />
        </div>
        <HintText hint={reverseHint}>
          Thorns shoot into the letter instead of out of it. Through strokes they cut a slit; across counters and past the
          far side they show as ink. In Burst, the outline between spikes bulges out instead of sinking in.
        </HintText>
        <RangeField
          id="thorn-dent"
          target="experimental.thorn.dent"
          label="Dent"
          value={dent}
          scale={100}
          unit="%"
          valueText={`${percent(dent)} percent`}
          disabled={off || !burst}
          hint={dentHint}
          hintText="In Burst: how deep the outline between spikes sinks into the strokes, in a few straight cuts. 0%: the outline stays as it was."
          onChange={(dent) => update({ dent })}
        />
        <RangeField
          id="thorn-root"
          target="experimental.thorn.root"
          label="Root"
          value={root}
          scale={100}
          unit="%"
          valueText={`${percent(root)} percent`}
          disabled={off || burst}
          hint={rootHint}
          hintText={`How much of the letter around each anchor its thorn pulls along, up to ${percent(THORN_LIMITS.maxRoot)}% of the em away. The thorn grows from a wide root that narrows to its tip, and the strokes and counters inside the root lean and bend with it. 0%: the thorns are only added on. Not used in Burst.`}
          onChange={(root) => update({ root })}
        />
        <RangeField
          id="thorn-spread"
          target="experimental.thorn.spread"
          label="Spread"
          value={params.spread}
          scale={100}
          unit="%"
          valueText={`${percent(params.spread)} percent`}
          disabled={off}
          hint={spreadHint}
          hintText="0%: every anchor jumps straight out from the outline. 100%: anywhere up to 90° to either side."
          onChange={(spread) => update({ spread })}
        />
        <RangeField
          id="thorn-width"
          target="experimental.thorn.width"
          label="Width"
          value={params.width}
          scale={100}
          unit="%"
          valueText={`${percent(params.width)} percent`}
          disabled={off}
          hint={widthHint}
          hintText="How wide each thorn's tip is where it leaves its root. 0%: a thin needle. 100%: the tip starts where the root starts to narrow (at Root 0%, it pulls the anchor's whole edges along)."
          onChange={(width) => update({ width })}
        />
        <RangeField
          id="thorn-refraction"
          target="experimental.thorn.refraction"
          label="Refraction"
          value={refraction}
          scale={100}
          unit="%"
          valueText={`${percent(refraction)} percent`}
          disabled={off}
          hint={refractionHint}
          hintText="Shows the letter through fluted glass: it is cut into vertical strips, each magnified a little and moved up or down, so strokes and thorns look broken and offset. The glass covers the letter; thorn tips reaching past it to the left or right stay sharp. 0%: off."
          onChange={(refraction) => update({ refraction })}
        />
        <RangeField
          id="thorn-flute"
          target="experimental.thorn.flute"
          label="Flute width"
          value={flute}
          scale={100}
          unit="% em"
          valueText={`${percent(flute)} percent of the em`}
          disabled={off || refraction === 0}
          hint={fluteHint}
          hintText="How wide each strip of the fluted glass is, as a share of the em."
          onChange={(flute) => update({ flute })}
        />

        {stats?.applied && (
          <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
            <div>
              <dt>{burst ? 'Spikes' : 'Thorns'}</dt>
              <dd>{stats.thorns}</dd>
            </div>
            {!burst && (
              <div>
                <dt>Roots</dt>
                <dd>{stats.roots}</dd>
              </div>
            )}
            <div>
              <dt>Longest</dt>
              <dd>
                {stats.longest.toFixed(0)}
                <span className="unit">u</span>
              </dd>
            </div>
          </dl>
        )}
        {(stats?.reducedContours ?? 0) > 0 && (
          <p className="font-warning">
            {stats!.reducedContours} {stats!.reducedContours === 1 ? 'contour uses' : 'contours use'} a weaker root or refraction
            to stay valid.
          </p>
        )}
        {(stats?.fallbackContours ?? 0) > 0 && (
          <p className="font-warning">This glyph is left without roots or refraction: no strength kept it valid.</p>
        )}
        {stats?.tooComplex && <p className="font-warning">This glyph is left without roots or refraction: too complex.</p>}
      </div>
    </fieldset>
  )
}

function DissolveGroup({
  params,
  stats,
  pending,
  disabled,
  onChange,
}: Omit<GroupProps<DissolveParams>, 'stats'> & { stats: DissolveStats | null }) {
  const update = (patch: Partial<DissolveParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const amountHint = useHint()
  const grainHint = useHint()
  const spreadHint = useHint()
  const specksHint = useHint()
  const curlHint = useHint()
  const facetsHint = useHint()

  return (
    <fieldset className="group experimental" disabled={disabled}>
      <legend>
        Dissolve <HintButton hint={introHint} topic="Dissolve" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Dissolves the letters like worn photocopied ink: islands and rings of ink, dense along the strokes, with loose
          specks just outside. Every island, ring and speck is a polygon of straight edges and sharp corners. The seed
          picks the pattern. Runs last, after Thorn.
        </HintText>

        <div className="field field-toggle">
          <input id="dissolve-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="dissolve-enabled">Use dissolve</label>
          <LiveSwitch target="experimental.dissolve.enabled" />
        </div>

        <RangeField
          id="dissolve-amount"
          target="experimental.dissolve.amount"
          label="Amount"
          value={params.amount}
          scale={100}
          unit="%"
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          hint={amountHint}
          hintText="How much ink is eaten away. 0%: a nearly solid letter with a ragged edge. 100%: only thin squiggles and rings are left."
          onChange={(amount) => update({ amount })}
        />
        <RangeField
          id="dissolve-grain"
          target="experimental.dissolve.grain"
          label="Grain"
          value={params.grain}
          scale={100}
          unit="% stroke"
          valueText={`${percent(params.grain)} percent of the stroke`}
          disabled={off}
          hint={grainHint}
          hintText="Size of the islands and rings, as a share of the stroke width. Small grain gives fine, busy ink; large grain gives a few coarse blobs."
          onChange={(grain) => update({ grain })}
        />
        <RangeField
          id="dissolve-spread"
          target="experimental.dissolve.spread"
          label="Spread"
          value={params.spread}
          scale={100}
          unit="%"
          valueText={`${percent(params.spread)} percent`}
          disabled={off}
          hint={spreadHint}
          hintText="How far the ragged edge reaches past the outline, in half-strokes: at 100% it reaches half a stroke out."
          onChange={(spread) => update({ spread })}
        />
        <RangeField
          id="dissolve-specks"
          target="experimental.dissolve.specks"
          label="Specks"
          value={params.specks}
          scale={100}
          unit="%"
          valueText={`${percent(params.specks)} percent`}
          disabled={off}
          hint={specksHint}
          hintText="How many loose specks lie just outside the strokes. 0%: none."
          onChange={(specks) => update({ specks })}
        />
        <RangeField
          id="dissolve-curl"
          target="experimental.dissolve.curl"
          label="Curl"
          value={params.curl}
          scale={100}
          unit="%"
          valueText={`${percent(params.curl)} percent`}
          disabled={off}
          hint={curlHint}
          hintText="0%: plain blobs. 100%: the ink wanders into loops and rings."
          onChange={(curl) => update({ curl })}
        />
        <RangeField
          id="dissolve-facets"
          target="experimental.dissolve.facets"
          label="Facets"
          value={params.facets}
          scale={100}
          unit="%"
          valueText={`${percent(params.facets)} percent`}
          disabled={off}
          hint={facetsHint}
          hintText="How long the straight edges are. 0%: short edges, still with clear corners. 100%: long edges, chunky shards; small rings close up."
          onChange={(facets) => update({ facets })}
        />

        {stats?.applied && (
          <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
            <div>
              <dt>Islands</dt>
              <dd>{stats.islands}</dd>
            </div>
            <div>
              <dt>Holes</dt>
              <dd>{stats.holes}</dd>
            </div>
            <div>
              <dt>Facet</dt>
              <dd>
                {stats.facet.toFixed(0)}
                <span className="unit">u</span>
              </dd>
            </div>
          </dl>
        )}
        {stats?.coarser && <p className="font-warning">This glyph is too large for the grain: it is dissolved more coarsely.</p>}
        {stats?.reduced && <p className="font-warning">Longer facets on this glyph: these settings make too many vertices.</p>}
      </div>
    </fieldset>
  )
}

/**
 * A slider that is not linear: its range input's own range, how a value maps to a position on it and back, and
 * the value's own range and finest step, for its number box.
 */
interface SliderCurve {
  slider: SliderRange
  toSlider: (value: number) => number
  fromSlider: (position: number) => number
  value: SliderRange
}

type RangeFieldProps = {
  id: string
  label: string
  value: number
  /** What the number box shows per unit of the value: 100 for a share shown in percent. */
  scale?: number
  unit?: string
  valueText: string
  disabled: boolean
  hint?: HintState
  hintText?: string
  onChange: (value: number) => void
} & (
  /** The Sound target this slider is ("experimental.crumple.amount"): its range, and its live marker. */
  | { target: SliderId; curve?: undefined }
  /** A curved slider (Reach): its Sound target, for the live marker, and its curve. */
  | { target: string; curve: SliderCurve }
)

/** A labelled slider with a number box for its value, the live marker while Sound drives it, and an optional ⓘ explanation. */
function RangeField({ id, target, curve, label, value, scale, unit, valueText, disabled, hint, hintText, onChange }: RangeFieldProps) {
  const range = curve ? curve.slider : SLIDER_RANGES[target]
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-title">
          <label htmlFor={id}>{label}</label>
          {hint && <HintButton hint={hint} topic={label} />}
        </span>
        <SliderNumber
          {...(curve ? curve.value : range)}
          value={value}
          scale={scale}
          unit={unit}
          label={label}
          disabled={disabled}
          onCommit={onChange}
        />
      </div>
      <span className="live-slider">
        <input
          id={id}
          type="range"
          {...range}
          value={curve ? curve.toSlider(value) : value}
          disabled={disabled}
          aria-valuetext={valueText}
          aria-describedby={hint?.id}
          onChange={(e) => onChange(curve ? curve.fromSlider(Number(e.target.value)) : Number(e.target.value))}
        />
        <LiveMarker target={target} />
      </span>
      {hint && hintText && <HintText hint={hint}>{hintText}</HintText>}
    </div>
  )
}

/** What merging the overlaps did, when an effect goes beyond 100% or the glyph was simplified, and why it may not have. */
function FoldStats({ stats, pending }: { stats: ExperimentalStats | null; pending: boolean }) {
  const folds = stats?.folds
  const budget = stats?.budget
  return (
    <>
      <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
        <div>
          <dt>Crossings merged</dt>
          <dd>{folds?.applied ? folds.crossings : '–'}</dd>
        </div>
        <div>
          <dt>Slivers dropped</dt>
          <dd>{folds?.applied ? folds.removed : '–'}</dd>
        </div>
      </dl>
      {budget?.applied && (
        <p className="font-warning">
          Simplified: these settings make too many vertices or crossings, so the outline was reduced (tolerance{' '}
          {Math.round(budget.tolerance).toLocaleString('en-US')} u).
        </p>
      )}
      {folds?.failed && <p className="font-warning">Overlaps could not be merged; the outline is left as it is.</p>}
      {folds?.tooComplex && <p className="font-warning">Too complex to merge; lower the settings.</p>}
    </>
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
      {stats.tooComplex && <p className="font-warning">This glyph is left without {effect}: too complex.</p>}
    </>
  )
}

// Live frames re-render the panel; a group skips them unless its own props or statistics change.
export default memo(ExperimentalControls, sameControlProps)
