import { ARTBOARD_LIMITS, type ArtboardParams } from '../specimen/artboard'
import NumberField from './NumberField'
import Icon from './Icon'

interface CanvasSizeControlsProps {
  params: ArtboardParams
  onChange: (patch: Partial<ArtboardParams>) => void
}

const ratios: [number, number][] = [
  [1, 1],
  [4, 3],
  [16, 9],
  [4, 5],
  [3, 2],
  [3, 4],
]

const clampSide = (v: number) => Math.round(Math.min(ARTBOARD_LIMITS.max, Math.max(ARTBOARD_LIMITS.min, v)))

/**
 * Below the canvas: the canvas (artboard) size in pixels, common aspect ratios, and the export
 * multiplier. Basic: width × height. Advanced: 1×–4× multiplies the PNG resolution.
 */
export default function CanvasSizeControls({ params, onChange }: CanvasSizeControlsProps) {
  const { width, height, scale } = params

  /** Keeps the width and sets the height from the ratio; if that is too tall, keeps the height instead. */
  const applyRatio = (a: number, b: number) => {
    const h = Math.round((width * b) / a)
    if (h <= ARTBOARD_LIMITS.max && h >= ARTBOARD_LIMITS.min) onChange({ height: h })
    else {
      const nextHeight = clampSide(h)
      onChange({ height: nextHeight, width: clampSide((nextHeight * a) / b) })
    }
  }
  const isRatio = (a: number, b: number) => Math.abs(width / height - a / b) < 0.005

  return (
    <div className="canvas-size-controls">
      <div className="canvas-size-group" role="group" aria-label="Size">
        {(
          [
            ['W', 'width', 'Canvas width'],
            ['H', 'height', 'Canvas height'],
          ] as const
        ).map(([short, key, label]) => (
          <div key={key} className="canvas-size-row">
            <label htmlFor={`canvas-${key}`} className="canvas-size-axis" title={label}>
              {short}
            </label>
            <input
              id={`canvas-${key}`}
              type="range"
              min={ARTBOARD_LIMITS.min}
              max={ARTBOARD_LIMITS.max}
              step={10}
              value={params[key]}
              aria-label={`${label} in pixels`}
              aria-valuetext={`${params[key]} pixels`}
              onChange={(e) => onChange({ [key]: Number(e.target.value) })}
            />
            <NumberField
              value={params[key]}
              min={ARTBOARD_LIMITS.min}
              max={ARTBOARD_LIMITS.max}
              step={1}
              aria-label={`${label} in pixels`}
              onCommit={(v) => onChange({ [key]: v })}
            />
          </div>
        ))}
      </div>

      <div className="canvas-size-group">
        <div className="ratio-grid" role="group" aria-label="Aspect ratio">
          {ratios.map(([a, b]) => (
            <button
              key={`${a}:${b}`}
              type="button"
              className="button-small"
              aria-pressed={isRatio(a, b)}
              title={`Keep the width, set the height for ${a}:${b}`}
              onClick={() => applyRatio(a, b)}
            >
              {a}:{b}
            </button>
          ))}
        </div>
        <button type="button" className="button-small swap-button" onClick={() => onChange({ width: height, height: width })}>
          <Icon name="swap" />
          Swap
        </button>
      </div>

      <div className="canvas-size-group canvas-size-scale">
        <div className="scale-row" role="group" aria-label="Export multiplier">
          {ARTBOARD_LIMITS.scales.map((s) => (
            <button key={s} type="button" className="button-small" aria-pressed={scale === s} onClick={() => onChange({ scale: s })}>
              {s}×
            </button>
          ))}
        </div>
        <p className="field-hint">
          PNG {width * scale} × {height * scale} px
        </p>
      </div>
    </div>
  )
}
