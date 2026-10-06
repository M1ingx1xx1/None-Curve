import type { ReactNode } from 'react'
import { INPUT_PANEL_MIN } from './InputPanel'
import { SplitHandle, useSplit } from './useSplit'

interface WorkspaceProps {
  /** Top left: import and font information. */
  tools: ReactNode
  /** Top left, below the tools: geometry parameters. */
  geometry: ReactNode
  /** Top right: the result canvas (text only). */
  canvas: ReactNode
  /** Bottom left: glyph list (inserts characters into the text). */
  glyphs: ReactNode
  /** Bottom right: text input, the Typography and Color tabs, and the canvas miniature. */
  input: ReactNode
  /** Narrow screens only: whether the geometry parameters are expanded. */
  geometryOpen: boolean
}

/**
 * Two rows that always fill the window between the header and the status bar:
 *   ┌ tools + geometry ║ canvas          ┐   ← top row; ║ moves the tools / canvas border
 *   ╞═══════════════════════════════════╡   ← moves the border between the rows
 *   └ glyphs     ║ input ║ style ║ preview  ┘   ← bottom row; the handles right of input are in InputPanel
 * Each handle only moves a border: the panes on either side always add up to the same size.
 * Narrow screens stack tools, canvas, geometry (collapsible), input, glyphs, without handles.
 */
export default function Workspace({ tools, geometry, canvas, glyphs, input, geometryOpen }: WorkspaceProps) {
  const rows = useSplit<HTMLElement>({
    storageKey: 'none-curve:row-split',
    defaultValue: 0.62,
    axis: 'y',
    minStart: 220,
    minEnd: 160,
    cssVars: ['--rows-top', '--rows-bottom'],
  })
  const columns = useSplit<HTMLDivElement>({
    storageKey: 'none-curve:side-split',
    defaultValue: 0.3,
    axis: 'x',
    minStart: 280,
    minEnd: 320,
    cssVars: ['--side-width', '--canvas-width'],
  })
  // Glyphs | text input + style + preview. The second pane's minimum leaves room for all of
  // InputPanel's minimums and its handles.
  const bottom = useSplit<HTMLDivElement>({
    storageKey: 'none-curve:glyphs-split',
    defaultValue: 0.24,
    axis: 'x',
    minStart: 220,
    minEnd: INPUT_PANEL_MIN,
    cssVars: ['--glyphs-width', '--input-width'],
  })

  return (
    <main ref={rows.containerRef} className="workspace" style={rows.style} data-geometry={geometryOpen ? 'open' : 'closed'}>
      <div ref={columns.containerRef} className="workspace-top" style={columns.style}>
        <div className="workspace-side">
          <div className="workspace-tools">{tools}</div>
          <div className="workspace-geometry">{geometry}</div>
        </div>
        <SplitHandle
          axis="x"
          strong
          label="Resize the tools and the canvas"
          valueText={`Tools ${columns.percent}%, canvas ${100 - columns.percent}%`}
          handleProps={columns.handleProps}
        />
        <div className="workspace-canvas">{canvas}</div>
      </div>
      <SplitHandle
        axis="y"
        strong
        label="Resize the top and bottom areas"
        valueText={`Top ${rows.percent}%, bottom ${100 - rows.percent}%`}
        handleProps={rows.handleProps}
      />
      <div ref={bottom.containerRef} className="workspace-bottom" style={bottom.style}>
        <div className="workspace-glyphs">{glyphs}</div>
        <SplitHandle
          axis="x"
          strong
          label="Resize the glyph list and the text input"
          valueText={`Glyphs ${bottom.percent}%, text, style, and preview ${100 - bottom.percent}%`}
          handleProps={bottom.handleProps}
        />
        <div className="workspace-input">{input}</div>
      </div>
    </main>
  )
}
