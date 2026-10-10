import { useState, type Dispatch } from 'react'
import { RANDOM_ANCHOR_LIMITS, type RandomAnchorStats } from '../geometry/randomAnchors'
import type { RandomAnchorParams } from '../geometry/types'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint } from './Hint'
import Icon from './Icon'

interface RandomAnchorControlsProps {
  params: RandomAnchorParams
  stats: RandomAnchorStats | null
  pending: boolean
  disabled: boolean
  dispatch: Dispatch<Action>
}

export const DEFAULT_RANDOM: RandomAnchorParams = { enabled: false, density: 12, randomness: 1, keepCorners: true, seed: 1 }
const HISTORY_LENGTH = 6

/** A fresh seed for the Shuffle button. Only the UI picks seeds at random; the geometry stays deterministic. */
function pickSeed(current: number): number {
  const values = new Uint32Array(1)
  let seed = current
  while (seed === current) {
    crypto.getRandomValues(values)
    seed = values[0] % (RANDOM_ANCHOR_LIMITS.maxSeed + 1)
  }
  return seed
}

export default function RandomAnchorControls({ params, stats, pending, disabled, dispatch }: RandomAnchorControlsProps) {
  const update = (patch: Partial<RandomAnchorParams>) => dispatch({ type: 'updateParams', group: 'random', patch })
  // Seeds used before the current one in this session, newest first, so a good result can be found again.
  const [history, setHistory] = useState<number[]>([])
  const [copied, setCopied] = useState(false)
  const off = disabled || !params.enabled
  // At 0% randomness the anchors are evenly spaced, so the seed has nothing to choose.
  const seedOff = off || params.randomness === 0
  const introHint = useHint()
  const densityHint = useHint()
  const seedHint = useHint()
  const percent = Math.round(params.randomness * 100)
  const isDefault = (Object.keys(DEFAULT_RANDOM) as (keyof RandomAnchorParams)[]).every(
    (k) => k === 'seed' || params[k] === DEFAULT_RANDOM[k],
  )

  const setSeed = (seed: number) => {
    if (seed === params.seed) return
    setHistory((h) => [params.seed, ...h.filter((s) => s !== params.seed && s !== seed)].slice(0, HISTORY_LENGTH))
    setCopied(false)
    update({ seed })
  }

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(String(params.seed))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <fieldset className="group random-anchors" disabled={disabled}>
      <legend>
        Random anchors <HintButton hint={introHint} topic="Random anchors" />
      </legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <HintText hint={introHint}>
          Places anchors at random points on the original curves instead of Flatten’s regular spacing, so every anchor
          still lies on the letter’s outline. Runs in place of Flatten’s sampling; Squaring, Anchors, Grid, and
          Distortion then work on the result. Each seed gives one fixed result, so write down a seed you like.
        </HintText>

        <div className="field field-toggle">
          <input
            id="random-enabled"
            type="checkbox"
            checked={params.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span className="field-title">
            <label htmlFor="random-enabled">Use random anchors</label>

          </span>
        </div>

        <div className="field">
          <div className="field-head">
            <span className="field-title">
              <label htmlFor="random-density">Density</label>
              <HintButton hint={densityHint} topic="Density" />
            </span>
            <output htmlFor="random-density">
              {params.density}
              <span className="unit">/1000 u</span>
            </output>
          </div>
          <input
            id="random-density"
            type="range"
            min={RANDOM_ANCHOR_LIMITS.minDensity}
            max={RANDOM_ANCHOR_LIMITS.maxDensity}
            step={1}
            value={params.density}
            disabled={off}
            aria-valuetext={`${params.density} anchors per 1000 font units`}
            aria-describedby={densityHint.id}
            onChange={(e) => update({ density: Number(e.target.value) })}
          />
          <HintText hint={densityHint}>
            About how many anchors per 1000 font units of outline. Low values give rough, faceted letters; every contour
            keeps at least 3 anchors.
          </HintText>
        </div>

        <div className="field">
          <div className="field-head">
            <span className="field-title">
              <label htmlFor="random-randomness">Randomness</label>

            </span>
            <output htmlFor="random-randomness">{percent}%</output>
          </div>
          <input
            id="random-randomness"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.randomness}
            disabled={off}
            aria-valuetext={`${percent} percent`}
            onChange={(e) => update({ randomness: Number(e.target.value) })}
          />
        </div>

        <div className="field field-toggle">
          <input
            id="random-corners"
            type="checkbox"
            checked={params.keepCorners}
            disabled={off}
            onChange={(e) => update({ keepCorners: e.target.checked })}
          />
          <span className="field-title">
            <label htmlFor="random-corners">Keep sharp corners</label>

          </span>
        </div>

        <div className="field">
          <span className="field-title">
            <label htmlFor="random-seed">Seed</label>
            <HintButton hint={seedHint} topic="Seed" />
          </span>
          <div className="seed-row">
            <input
              id="random-seed"
              type="number"
              min={0}
              max={RANDOM_ANCHOR_LIMITS.maxSeed}
              step={1}
              value={params.seed}
              disabled={seedOff}
              aria-describedby={seedHint.id}
              onChange={(e) => {
                const value = Math.trunc(Number(e.target.value))
                // Typed seeds skip the history; a seed enters it once Shuffle or a previous seed replaces it.
                if (Number.isFinite(value)) update({ seed: Math.min(RANDOM_ANCHOR_LIMITS.maxSeed, Math.max(0, value)) })
              }}
            />
            <button type="button" className="button-small" disabled={seedOff} onClick={() => setSeed(pickSeed(params.seed))}>
              <Icon name="shuffle" />
              Shuffle
            </button>
            <button type="button" className="button-small" disabled={seedOff} onClick={copySeed}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {params.randomness === 0 && params.enabled ? (
            // Why the seed is greyed out: a state note, so it is always shown.
            <p id={seedHint.id} className="field-hint">
              At 0% Randomness the anchors are evenly spaced, so the seed has no effect. Raise Randomness to use it.
            </p>
          ) : (
            <HintText hint={seedHint}>
              Shuffle picks a new random seed. To reproduce a result, type its seed here with the same settings and font.
            </HintText>
          )}
          {history.length > 0 && (
            <div className="seed-history" role="group" aria-label="Previous seeds">
              <span className="field-label">Previous</span>
              {history.map((seed) => (
                <button key={seed} type="button" className="button-small" disabled={seedOff} onClick={() => setSeed(seed)}>
                  {seed}
                </button>
              ))}
            </div>
          )}
        </div>

        {stats?.applied && (
          <dl className="flatten-stats" aria-live="polite" aria-busy={pending}>
            <div>
              <dt>Seed</dt>
              <dd>{params.seed}</dd>
            </div>
            <div>
              <dt>Anchors</dt>
              <dd>{stats.anchors}</dd>
            </div>
            <div>
              <dt>Corners kept</dt>
              <dd>{stats.corners}</dd>
            </div>
          </dl>
        )}
        {stats && stats.redrawnContours > 0 && (
          <p className="field-hint">
            {stats.redrawnContours} {stats.redrawnContours === 1 ? 'contour was' : 'contours were'} drawn again with a
            derived seed because the first draw reversed or crossed itself. Still reproducible.
          </p>
        )}
        {stats && stats.fallbackContours > 0 && (
          <p className="font-warning">
            {stats.fallbackContours} {stats.fallbackContours === 1 ? 'contour uses' : 'contours use'} Flatten’s result:
            no random draw kept {stats.fallbackContours === 1 ? 'it' : 'them'} valid.
          </p>
        )}

        <button type="button" className="button-small" disabled={disabled || isDefault} onClick={() => update({ ...DEFAULT_RANDOM, seed: params.seed })}>
          <Icon name="reset" />
          Reset random anchors
        </button>
      </div>
    </fieldset>
  )
}
