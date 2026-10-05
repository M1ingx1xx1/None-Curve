import type { ReactNode } from 'react'
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
  /** Bottom right: text input and the canvas miniature. */
  input: ReactNode
  /** Narrow screens only: whether the geometry parameters are expanded. */
  geometryOpen: boolean
}

/**
 * Two rows that always fill the window between the header and the status bar:
 *   ┌ tools + geometry ║ canvas          ┐   ← top row; ║ moves the tools / canvas border
 *   ╞═══════════════════════════════════╡   ← moves the border between the rows
 *   └ glyphs           │ input ║ preview  ┘   ← bottom row (its own handle is in InputPanel)
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
      <div className="workspace-bottom">
        <div className="workspace-glyphs">{glyphs}</div>
        <div className="workspace-input">{input}</div>
      </div>
    </main>
  )
}
