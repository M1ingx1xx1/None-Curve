import type { ReactNode } from 'react'

interface WorkspaceProps {
  /** Top left: import and font information. */
  tools: ReactNode
  /** Top left, below the tools: geometry parameters. */
  geometry: ReactNode
  /** Top right: the result canvas (text only). */
  canvas: ReactNode
  /** Bottom left: glyph list. */
  glyphs: ReactNode
  /** Bottom right: text input and selected-glyph preview. */
  input: ReactNode
  /** Narrow screens only: whether the geometry parameters are expanded. */
  geometryOpen: boolean
}

/**
 * Four-quadrant workspace:
 *   ┌ tools + geometry ┬ canvas          ┐
 *   └ glyphs           ┴ input | preview ┘
 * Narrow screens stack tools, canvas, geometry (collapsible), input, glyphs.
 */
export default function Workspace({ tools, geometry, canvas, glyphs, input, geometryOpen }: WorkspaceProps) {
  return (
    <main className="workspace" data-geometry={geometryOpen ? 'open' : 'closed'}>
      <div className="workspace-tools">{tools}</div>
      <div className="workspace-geometry">{geometry}</div>
      <div className="workspace-canvas">{canvas}</div>
      <div className="workspace-glyphs">{glyphs}</div>
      <div className="workspace-input">{input}</div>
    </main>
  )
}
