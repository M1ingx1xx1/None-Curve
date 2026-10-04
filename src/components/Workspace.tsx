import type { ReactNode } from 'react'

interface WorkspaceProps {
  controls: ReactNode
  viewport: ReactNode
  strip: ReactNode
}

/** Workspace layout: controls on the left, canvas and glyph strip on the right. */
export default function Workspace({ controls, viewport, strip }: WorkspaceProps) {
  return (
    <main className="workspace">
      <div className="workspace-controls">{controls}</div>
      <div className="workspace-stage">
        {viewport}
        {strip}
      </div>
    </main>
  )
}
