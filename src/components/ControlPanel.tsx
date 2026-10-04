import type { Dispatch, ReactNode } from 'react'
import type { Action } from '../state/editorState'
import type { AppState, ExportFormat } from '../state/types'

interface ControlPanelProps {
  state: AppState
  dispatch: Dispatch<Action>
}

interface RangeFieldProps {
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

function RangeField({ id, label, hint, value, min, max, step = 1, unit, onChange }: RangeFieldProps) {
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>
          {value}
          {unit && <span className="unit">{unit}</span>}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p id={`${id}-hint`} className="field-hint">
        {hint}
      </p>
    </div>
  )
}

interface ToggleFieldProps {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleField({ id, label, checked, onChange }: ToggleFieldProps) {
  return (
    <div className="field field-toggle">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  )
}

function Group({ title, disabled, children }: { title: string; disabled: boolean; children: ReactNode }) {
  return (
    <fieldset className="group" disabled={disabled}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

const flattenModes = [
  ['adaptive', 'Adaptive'],
  ['segments', 'Fixed segments'],
] as const

export default function ControlPanel({ state, dispatch }: ControlPanelProps) {
  const { params, document } = state
  const locked = document.status.kind !== 'ready'
  const { flatten, anchors, grid, distortion } = params

  return (
    <aside className="panel" aria-label="Controls">
      {locked && <p className="panel-notice">Load a font to adjust these parameters. Font import arrives in a later phase.</p>}

      <Group title="Glyph" disabled={locked}>
        <div className="field">
          <label htmlFor="glyph-select">Current glyph</label>
          <select id="glyph-select" value="" onChange={() => {}}>
            <option value="">None selected</option>
          </select>
        </div>
      </Group>

      <Group title="Deconstruction" disabled={locked}>
        <div className="field">
          <span className="field-label" id="flatten-mode-label">
            Curve to line method
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="flatten-mode-label">
            {flattenModes.map(([mode, label]) => (
              <label key={mode} className="segment-option">
                <input
                  type="radio"
                  name="flatten-mode"
                  value={mode}
                  checked={flatten.mode === mode}
                  onChange={() => dispatch({ type: 'updateParams', group: 'flatten', patch: { mode } })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {flatten.mode === 'adaptive' ? (
          <RangeField
            id="flatten-tolerance"
            label="Tolerance"
            hint="Lower tolerance yields more segments and vertices."
            value={flatten.tolerance}
            min={0.1}
            max={20}
            step={0.1}
            unit="u"
            onChange={(tolerance) => dispatch({ type: 'updateParams', group: 'flatten', patch: { tolerance } })}
          />
        ) : (
          <RangeField
            id="flatten-segments"
            label="Segments per curve"
            hint="More segments give a finer curve approximation."
            value={flatten.segmentsPerCurve}
            min={1}
            max={32}
            onChange={(segmentsPerCurve) =>
              dispatch({ type: 'updateParams', group: 'flatten', patch: { segmentsPerCurve } })
            }
          />
        )}
      </Group>

      <Group title="Geometry & Grid" disabled={locked}>
        <RangeField
          id="anchor-spacing"
          label="Anchor spacing"
          hint="Adds points along edges up to this spacing. 0 turns it off."
          value={anchors.spacing}
          min={0}
          max={200}
          unit="u"
          onChange={(spacing) => dispatch({ type: 'updateParams', group: 'anchors', patch: { spacing } })}
        />
        <RangeField
          id="anchor-simplify"
          label="Simplify"
          hint="Removes redundant vertices. 0 turns it off."
          value={anchors.simplify}
          min={0}
          max={20}
          step={0.5}
          onChange={(simplify) => dispatch({ type: 'updateParams', group: 'anchors', patch: { simplify } })}
        />
        <ToggleField
          id="grid-snap"
          label="Snap to grid"
          checked={grid.snap}
          onChange={(snap) => dispatch({ type: 'updateParams', group: 'grid', patch: { snap } })}
        />
        <RangeField
          id="grid-size"
          label="Grid size"
          hint="Spacing of the snapping grid."
          value={grid.size}
          min={1}
          max={100}
          unit="u"
          onChange={(size) => dispatch({ type: 'updateParams', group: 'grid', patch: { size } })}
        />
        <ToggleField
          id="angle-lock"
          label={`Angle lock (${grid.angleStep}° steps)`}
          checked={grid.angleLock}
          onChange={(angleLock) => dispatch({ type: 'updateParams', group: 'grid', patch: { angleLock } })}
        />
      </Group>

      <Group title="Distortion" disabled={locked}>
        <RangeField
          id="distortion-amount"
          label="Vertex jitter"
          hint="Randomly offsets vertices. 0 turns it off."
          value={distortion.amount}
          min={0}
          max={50}
          unit="u"
          onChange={(amount) => dispatch({ type: 'updateParams', group: 'distortion', patch: { amount } })}
        />
        <div className="field">
          <label htmlFor="distortion-seed">Random seed</label>
          <input
            id="distortion-seed"
            type="number"
            min={0}
            value={distortion.seed}
            onChange={(e) =>
              dispatch({ type: 'updateParams', group: 'distortion', patch: { seed: Number(e.target.value) } })
            }
          />
        </div>
      </Group>

      <Group title="Export" disabled={locked}>
        <div className="field">
          <label htmlFor="export-format">Format</label>
          <select
            id="export-format"
            value={document.export.format}
            onChange={(e) => dispatch({ type: 'updateExport', patch: { format: e.target.value as ExportFormat } })}
          >
            <option value="svg">SVG (current glyph)</option>
            <option value="otf">OTF (font file)</option>
          </select>
        </div>
        <RangeField
          id="export-precision"
          label="Precision"
          hint="Decimal places in SVG coordinates."
          value={document.export.precision}
          min={0}
          max={4}
          onChange={(precision) => dispatch({ type: 'updateExport', patch: { precision } })}
        />
        <button type="button" className="button-block" disabled title="Export is not implemented yet">
          Export<span className="pending">Soon</span>
        </button>
      </Group>

      <details className="planned">
        <summary>Sound carving · Planned</summary>
        <p>
          Optional extension: Sound → Carving Logic → Letterform. Maps sound features such as volume, pitch, and rhythm to carving parameters such as depth, pressure, and stroke width, then applies them to polygon letterforms.
        </p>
      </details>
    </aside>
  )
}
