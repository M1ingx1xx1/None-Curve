import type { ReactNode } from 'react'

interface WorkspaceProps {
  /** Top left: import and font information. */
  tools: ReactNode
  /** Top left, below the tools: geometry parameters. */
  geometry: ReactNode
  /** Top right: the result canvas. */
  canvas: ReactNode
  /** Bottom left: text input. */
  text: ReactNode
  /** Bottom right: glyph preview and selection. */
  glyphs: ReactNode
  /** Narrow screens only: whether the geometry parameters are expanded. */
  geometryOpen: boolean
}

/**
 * Four-quadrant workspace:
 *   ┌ tools + geometry ┬ canvas ┐
 *   └ text             ┴ glyphs ┘
 * Narrow screens stack tools, canvas, geometry (collapsible), text, glyphs.
 */
export default function Workspace({ tools, geometry, canvas, text, glyphs, geometryOpen }: WorkspaceProps) {
  return (
    <main className="workspace" data-geometry={geometryOpen ? 'open' : 'closed'}>
      <div className="workspace-tools">{tools}</div>
      <div className="workspace-geometry">{geometry}</div>
      <div className="workspace-canvas">{canvas}</div>
      <div className="workspace-text">{text}</div>
      <div className="workspace-glyphs">{glyphs}</div>
    </main>
  )
}
