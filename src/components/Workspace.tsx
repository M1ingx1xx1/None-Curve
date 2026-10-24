import { useEffect, useState, type ReactNode } from 'react'
import { INPUT_PANEL_MIN } from './InputPanel'
import { SplitHandle, useSplit } from './useSplit'

/** Whether the text tools are folded down to their tabs, and how to change it. */
export interface TextToolsFold {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

interface WorkspaceProps {
  /** Left, at the top: import and font information. */
  tools: ReactNode
  /** Left, below the tools: geometry parameters. */
  geometry: ReactNode
  /** Right, at the top: the result canvas (text only). */
  canvas: ReactNode
  /** Left, at the bottom: the Typography, Glyphs, and Color tabs, which can fold down to their tabs. */
  textTools: (fold: TextToolsFold) => ReactNode
  /** Right, at the bottom: text input and the canvas miniature. */
  input: ReactNode
}

const COLLAPSED_KEY = 'none-curve:text-tools-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Two columns that always fill the window between the header and the status bar:
 *   ┌ tools       ║ canvas           ┐
 *   │ geometry    ║                  │
 *   ├─────────────╫──────────────────┤   ← each column has its own border between top and bottom
 *   └ text tools  ║ input ║ preview  ┘   ← the input / preview handle is in InputPanel
 * The parameters get the full height of the left column: the text tools below them take a share of
 * it (their own handle), or fold down to their tabs and leave the rest to the parameters.
 * Each handle only moves a border: the panes on either side always add up to the same size.
 */
export default function Workspace({ tools, geometry, canvas, textTools, input }: WorkspaceProps) {
  const columns = useSplit<HTMLElement>({
    storageKey: 'none-curve:side-split',
    defaultValue: 0.3,
    axis: 'x',
    minStart: 280,
    minEnd: Math.max(320, INPUT_PANEL_MIN),
    cssVars: ['--side-width', '--canvas-width'],
  })
  // Canvas | text input and preview.
  const rows = useSplit<HTMLDivElement>({
    storageKey: 'none-curve:row-split',
    defaultValue: 0.62,
    axis: 'y',
    minStart: 220,
    minEnd: 160,
    cssVars: ['--rows-top', '--rows-bottom'],
  })
  // Geometry parameters | text tools, while the text tools are open.
  const side = useSplit<HTMLDivElement>({
    storageKey: 'none-curve:side-rows-split',
    defaultValue: 0.62,
    axis: 'y',
    minStart: 160,
    minEnd: 140,
    cssVars: ['--side-top', '--side-bottom'],
  })
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    } catch {
      // Not remembered; folding still works for this visit.
    }
  }, [collapsed])

  return (
    <main ref={columns.containerRef} className="workspace" style={columns.style}>
      <div className="workspace-side">
        <div className="workspace-tools">{tools}</div>
        <div
          ref={side.containerRef}
          className="workspace-panels"
          style={side.style}
          data-collapsed={collapsed || undefined}
        >
          <div className="workspace-geometry">{geometry}</div>
          {!collapsed && (
            <SplitHandle
              axis="y"
              label="Resize the parameters and the text tools"
              valueText={`Parameters ${side.percent}%, text tools ${100 - side.percent}%`}
              handleProps={side.handleProps}
            />
          )}
          <div className="workspace-glyphs">{textTools({ collapsed, onCollapsedChange: setCollapsed })}</div>
        </div>
      </div>
      <SplitHandle
        axis="x"
        label="Resize the tools and the canvas"
        valueText={`Tools ${columns.percent}%, canvas ${100 - columns.percent}%`}
        handleProps={columns.handleProps}
      />
      <div ref={rows.containerRef} className="workspace-main" style={rows.style}>
        <div className="workspace-canvas">{canvas}</div>
        <SplitHandle
          axis="y"
          label="Resize the canvas and the text input"
          valueText={`Canvas ${rows.percent}%, text input ${100 - rows.percent}%`}
          handleProps={rows.handleProps}
        />
        <div className="workspace-input">{input}</div>
      </div>
    </main>
  )
}
