import type { CSSProperties } from 'react'

/**
 * A span on one track with two thumbs (low and high): two range inputs laid over each other, drawn with straight
 * edges only (square thumbs, a flat band between them). Each thumb is its own slider for the keyboard and screen
 * readers; neither can pass the other (`minGap` apart at least). Values are whole numbers from `min` to `max`.
 */
export interface RangeControlProps {
  /** Names the pair ("Range, mapping 2"); each thumb is "<name> low" and "<name> high". */
  name: string
  low: number
  high: number
  min: number
  max: number
  step: number
  /** The least the two values stay apart. */
  minGap: number
  /** The readout beside the track ("20–80%"). */
  format: (low: number, high: number) => string
  /** A value as screen readers read it ("20 percent"). */
  valueText: (value: number) => string
  /** More ids that describe the control (an explanation under it). */
  describedBy?: string
  onChange: (change: { low?: number; high?: number }) => void
}

export default function RangeControl({ name, low, high, min, max, step, minGap, format, valueText, describedBy, onChange }: RangeControlProps) {
  const share = (value: number) => (max > min ? (value - min) / (max - min) : 0)
  return (
    <div className="range-control">
      <div className="range-control-track" style={{ '--low': share(low), '--high': share(high) } as CSSProperties}>
        <span className="range-control-band" aria-hidden="true" />
        {/* The low thumb lies over the high one in the upper half, so two thumbs that meet at the top can still part. */}
        <input
          type="range"
          className="range-control-low"
          data-top={share(low) > 0.5 || undefined}
          aria-label={`${name} low`}
          aria-valuetext={valueText(low)}
          aria-describedby={describedBy}
          min={min}
          max={max}
          step={step}
          value={low}
          onChange={(e) => {
            const next = Math.min(Number(e.target.value), high - minGap)
            if (next !== low) onChange({ low: next })
          }}
        />
        <input
          type="range"
          aria-label={`${name} high`}
          aria-valuetext={valueText(high)}
          aria-describedby={describedBy}
          min={min}
          max={max}
          step={step}
          value={high}
          onChange={(e) => {
            const next = Math.max(Number(e.target.value), low + minGap)
            if (next !== high) onChange({ high: next })
          }}
        />
      </div>
      <span className="range-control-value" aria-hidden="true">
        {format(low, high)}
      </span>
    </div>
  )
}
