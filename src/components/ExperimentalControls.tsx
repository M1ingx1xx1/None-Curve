import { memo, type Dispatch, type ReactNode } from 'react'
import { CRUMPLE_LIMITS } from '../geometry/crumple'
import { EXPERIMENTAL_LIMITS, experimentalMerges, type ExperimentalStats } from '../geometry/experimental'
import { RIPPLE_LIMITS } from '../geometry/ripple'
import { SLIPSTREAM_LIMITS, type SlipstreamStats } from '../geometry/slipstream'
import { THORN_LIMITS, type ThornStats } from '../geometry/thorn'
import type { CrumpleParams, ExperimentalParams, RippleParams, SlipstreamParams, ThornParams, WhorlParams } from '../geometry/types'
import type { WarpStats } from '../geometry/warp'
import { WHORL_LIMITS } from '../geometry/whorl'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint, type HintState } from './Hint'
import Icon from './Icon'
import LiveMarker from './LiveMarker'
import LiveSeed from './LiveSeed'
import { sameControlProps } from './sameControlProps'

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
  crumple: { enabled: false, amount: 0.7, facet: 0.18, turn: 0, detail: 0.5 },
  ripple: { enabled: false, amount: 0.5, wavelength: 0.3, sides: 8, centerX: 0.5, centerY: 0.5, fade: 0, petals: 0 },
  whorl: { enabled: false, amount: 0.6, rings: 6, sides: 8, pinned: true },
  slipstream: { enabled: false, direction: 0, strength: 0.15, gust: 0.12, gustiness: 0.6, slip: 0.15, cuts: 2, trails: 2 },
  thorn: { enabled: false, count: 3, reach: 0.6, spread: 0.5, width: 0.3, root: 0.5, refraction: 0, flute: 0.1 },
}

const percent = (v: number) => Math.round(v * 100)

/**
 * The Experimental tab: effects that run after the whole Geometry pipeline and can all be on at once.
 * Each folds the letter along straight creases, so it adds corners but never curves. Beyond 100% an
 * effect folds the letter onto itself, and the overlaps are merged into one outline.
 */
function ExperimentalControls({ params, stats, pending, disabled, dispatch, statistics }: ExperimentalControlsProps) {
  const update = (patch: Partial<ExperimentalParams>) => dispatch({ type: 'updateParams', group: 'experimental', patch })
  const introHint = useHint()
  const seedHint = useHint()
  // Reset keeps the seed, so a variant the user liked is not lost.
  const isDefault = JSON.stringify({ ...params, seed: 0 }) === JSON.stringify({ ...DEFAULT_EXPERIMENTAL, seed: 0 })

  return (
    <>
      <div className="panel-notice panel-intro">
        <p className="field-title">
          <span>Runs after Geometry: Crumple → Ripple → Whorl → Slipstream → Thorn. Effects can be on together.</span>
          <HintButton hint={introHint} topic="Experimental effects" />
        </p>
        {statistics}
        <HintText hint={introHint}>
          Each effect folds the letters along straight creases, so it adds corners but never curves. Up to 100%, any
          combination keeps every letter as it was arranged. Beyond that, parts of a letter fold over other parts; the
          overlaps are merged into one clean outline, so the letters still export. Slipstream’s cuts and Thorn’s thorns
          are merged the same way. Statistics are for the selected glyph.
        </HintText>
        {experimentalMerges(params) && <FoldStats stats={stats} pending={pending} />}
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
        onChange={(thorn) => update({ thorn })}
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
              Picks Crumple’s folds, Slipstream’s gusts, slips, cuts and trails, and Thorn’s anchors and flutes; Ripple and Whorl have
              no randomness. The same seed and settings always produce the same letters.
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

function CrumpleGroup({ params, stats, pending, disabled, onChange }: GroupProps<CrumpleParams>) {
  const update = (patch: Partial<CrumpleParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  const introHint = useHint()
  const amountHint = useHint()
  const detailHint = useHint()
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
          Crumples the letters like paper at three scales: large folds tilt and kink whole strokes, medium ones bend a
          stroke end here and there, and small sharp creases gather in busy stretches between calm ones. The outline bends
          only along straight creases; counters fold with the strokes around them.
        </HintText>

        <div className="field field-toggle">
          <input id="crumple-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="crumple-enabled">Use crumple</label>
        </div>

        <RangeField
          id="crumple-amount"
          target="experimental.crumple.amount"
          label="Amount"
          value={params.amount}
          min={0}
          max={CRUMPLE_LIMITS.maxAmount}
          step={0.1}
          display={`${percent(params.amount)}%`}
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          hint={amountHint}
          hintText="How far the folds move the outline. Above 100%, facets flip over their neighbours and the letter folds onto itself."
          onChange={(amount) => update({ amount })}
        />
        <RangeField
          id="crumple-detail"
          target="experimental.crumple.detail"
          label="Detail"
          value={params.detail ?? CRUMPLE_LIMITS.defaultDetail}
          min={0}
          max={1}
          step={0.05}
          display={`${percent(params.detail ?? CRUMPLE_LIMITS.defaultDetail)}%`}
          valueText={`${percent(params.detail ?? CRUMPLE_LIMITS.defaultDetail)} percent`}
          disabled={off}
          hint={detailHint}
          hintText="How the crumpling is shared between the scales. At 0 only the large folds bend whole strokes; higher values move strength to bent stroke ends and small sharp creases, and make their busy stretches longer. Up to 100% Amount the letter stays valid at any detail."
          onChange={(detail) => update({ detail })}
        />
        <RangeField
          id="crumple-facet"
          target="experimental.crumple.facet"
          label="Facet size"
          value={params.facet}
          min={CRUMPLE_LIMITS.minFacet}
          max={CRUMPLE_LIMITS.maxFacet}
          step={0.02}
          display={percent(params.facet)}
          unit="% em"
          valueText={`${percent(params.facet)} percent of the em`}
          disabled={off}
          hint={facetHint}
          hintText="Size of the medium triangles, as a share of the em; the large folds are 2.25 times as big, the small creases 0.4 times. Larger facets give fewer, bigger folds; the smallest still keeps creases far enough apart to read as corners."
          onChange={(facet) => update({ facet })}
        />
        <RangeField
          id="crumple-turn"
          target="experimental.crumple.turn"
          label="Turn"
          value={params.turn ?? 0}
          min={0}
          max={345}
          step={15}
          display={`${Math.round(params.turn ?? 0)}°`}
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
        </div>

        <RangeField
          id="ripple-amount"
          target="experimental.ripple.amount"
          label="Amount"
          value={params.amount}
          min={0}
          max={RIPPLE_LIMITS.maxAmount}
          step={0.1}
          display={`${percent(params.amount)}%`}
          valueText={`${percent(params.amount)} percent`}
          disabled={off}
          hint={amountHint}
          hintText="How far each ring moves. Above 100%, rings overtake each other and the letter folds onto itself."
          onChange={(amount) => update({ amount })}
        />
        <RangeField
          id="ripple-wavelength"
          target="experimental.ripple.wavelength"
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
          target="experimental.ripple.sides"
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
          target="experimental.ripple.centerX"
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
          target="experimental.ripple.centerY"
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
          target="experimental.ripple.fade"
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
        <RangeField
          id="ripple-petals"
          target="experimental.ripple.petals"
          label="Petals"
          value={params.petals ?? 0}
          min={0}
          max={RIPPLE_LIMITS.maxPetals}
          step={0.1}
          display={`${percent(params.petals ?? 0)}%`}
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
        </div>

        <RangeField
          id="whorl-amount"
          target="experimental.whorl.amount"
          label="Amount"
          value={params.amount}
          min={-WHORL_LIMITS.maxAmount}
          max={WHORL_LIMITS.maxAmount}
          step={0.1}
          display={`${percent(params.amount)}%`}
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
          min={WHORL_LIMITS.minRings}
          max={WHORL_LIMITS.maxRings}
          step={1}
          display={params.rings}
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
          min={WHORL_LIMITS.minSides}
          max={WHORL_LIMITS.maxSides}
          step={1}
          display={params.sides}
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
        </div>

        <RangeField
          id="slipstream-direction"
          target="experimental.slipstream.direction"
          label="Direction"
          value={params.direction}
          min={0}
          max={345}
          step={15}
          display={`${Math.round(params.direction)}°`}
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
          min={0}
          max={SLIPSTREAM_LIMITS.maxStrength}
          step={0.1}
          display={`${percent(params.strength)}%`}
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
          min={0}
          max={SLIPSTREAM_LIMITS.maxSlip}
          step={0.01}
          display={percent(slip)}
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
          min={SLIPSTREAM_LIMITS.minGust}
          max={SLIPSTREAM_LIMITS.maxGust}
          step={0.02}
          display={percent(params.gust)}
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
          min={0}
          max={SLIPSTREAM_LIMITS.maxGustiness}
          step={0.1}
          display={`${percent(params.gustiness)}%`}
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
          min={0}
          max={SLIPSTREAM_LIMITS.maxCuts}
          step={1}
          display={cuts}
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
          min={0}
          max={SLIPSTREAM_LIMITS.maxTrails}
          step={1}
          display={trails}
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
  onChange,
}: Omit<GroupProps<ThornParams>, 'stats'> & { stats: ThornStats | null }) {
  const update = (patch: Partial<ThornParams>) => onChange({ ...params, ...patch })
  const off = disabled || !params.enabled
  // Older saved settings lack the newer sliders.
  const root = params.root ?? DEFAULT_EXPERIMENTAL.thorn.root
  const refraction = params.refraction ?? 0
  const flute = params.flute ?? DEFAULT_EXPERIMENTAL.thorn.flute
  const introHint = useHint()
  const countHint = useHint()
  const reachHint = useHint()
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
          along: strokes lean and thin, and counters bend toward the thorn. Refraction then shows it all through fluted
          glass. The seed picks which anchors and where they go: Next variant, or Sound, makes them jump somewhere new.
          Runs after Slipstream.
        </HintText>

        <div className="field field-toggle">
          <input id="thorn-enabled" type="checkbox" checked={params.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <label htmlFor="thorn-enabled">Use thorn</label>
        </div>

        <RangeField
          id="thorn-count"
          target="experimental.thorn.count"
          label="Anchors"
          value={params.count}
          min={THORN_LIMITS.minCount}
          max={THORN_LIMITS.maxCount}
          step={1}
          display={params.count}
          valueText={`${params.count} ${params.count === 1 ? 'anchor' : 'anchors'}`}
          disabled={off}
          hint={countHint}
          hintText="How many anchors of each letter jump."
          onChange={(count) => update({ count })}
        />
        <RangeField
          id="thorn-reach"
          target="experimental.thorn.reach"
          label="Reach"
          value={params.reach}
          min={0}
          max={THORN_LIMITS.maxReach}
          step={0.05}
          display={percent(params.reach)}
          unit="% em"
          valueText={`${percent(params.reach)} percent of the em`}
          disabled={off}
          hint={reachHint}
          hintText="How far the anchors jump, as a share of the em. Each goes a random 35–100% of it."
          onChange={(reach) => update({ reach })}
        />
        <RangeField
          id="thorn-root"
          target="experimental.thorn.root"
          label="Root"
          value={root}
          min={0}
          max={1}
          step={0.05}
          display={`${percent(root)}%`}
          valueText={`${percent(root)} percent`}
          disabled={off}
          hint={rootHint}
          hintText={`How much of the letter around each anchor its thorn pulls along, up to ${percent(THORN_LIMITS.maxRoot)}% of the em away. The thorn grows from a wide root that narrows to its tip, and the strokes and counters inside the root lean and bend with it. 0%: the thorns are only added on.`}
          onChange={(root) => update({ root })}
        />
        <RangeField
          id="thorn-spread"
          target="experimental.thorn.spread"
          label="Spread"
          value={params.spread}
          min={0}
          max={1}
          step={0.05}
          display={`${percent(params.spread)}%`}
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
          min={0}
          max={1}
          step={0.05}
          display={`${percent(params.width)}%`}
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
          min={0}
          max={1}
          step={0.05}
          display={`${percent(refraction)}%`}
          valueText={`${percent(refraction)} percent`}
          disabled={off}
          hint={refractionHint}
          hintText="Shows the letter through fluted glass: it is cut into vertical strips, each magnified a little and moved up or down, so thorns and strokes look broken and offset. 0%: off."
          onChange={(refraction) => update({ refraction })}
        />
        <RangeField
          id="thorn-flute"
          target="experimental.thorn.flute"
          label="Flute width"
          value={flute}
          min={THORN_LIMITS.minFlute}
          max={THORN_LIMITS.maxFlute}
          step={0.01}
          display={percent(flute)}
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
              <dt>Thorns</dt>
              <dd>{stats.thorns}</dd>
            </div>
            <div>
              <dt>Roots</dt>
              <dd>{stats.roots}</dd>
            </div>
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
      </div>
    </fieldset>
  )
}

interface RangeFieldProps {
  id: string
  /** The Sound target this slider is ("experimental.crumple.amount"), for its live marker. */
  target: string
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

/** A labelled slider with its value, the live marker while Sound drives it, and an optional ⓘ explanation. */
function RangeField({ id, target, label, value, min, max, step, display, unit, valueText, disabled, hint, hintText, onChange }: RangeFieldProps) {
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
      <span className="live-slider">
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
        <LiveMarker target={target} />
      </span>
      {hint && hintText && <HintText hint={hint}>{hintText}</HintText>}
    </div>
  )
}

/** What merging the overlaps did, when an effect goes beyond 100%. */
function FoldStats({ stats, pending }: { stats: ExperimentalStats | null; pending: boolean }) {
  const folds = stats?.folds
  return (
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

// Live frames re-render the panel; a group skips them unless its own props or statistics change.
export default memo(ExperimentalControls, sameControlProps)
