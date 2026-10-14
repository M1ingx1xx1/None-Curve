import { UNDO_KEYS, type HistoryState } from '../state/history'
import type { DocumentState } from '../state/types'
import Icon from './Icon'

interface HeaderProps {
  document: DocumentState
  /** Whether the settings, text and Sound mappings can be undone or redone. */
  history: HistoryState
  onUndo: () => void
  onRedo: () => void
  onOpenExport: () => void
}

function fileStatusLabel(document: DocumentState): string {
  const { status, font } = document
  switch (status.kind) {
    case 'empty':
      return 'No font loaded'
    case 'loading':
      return `${status.label}…`
    case 'error':
      return font ? `Import failed · showing ${font.familyName}` : 'Import failed'
    case 'ready':
      return font ? `${font.familyName} ${font.styleName}` : 'Loaded'
  }
}

export default function Header({ document, history, onUndo, onRedo, onOpenExport }: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <h1>None-Curve</h1>
        <span className="brand-tag">Poly-Font Editor</span>
      </div>
      <p className="file-status" data-state={document.status.kind}>
        <span className="dot" aria-hidden="true" />
        {fileStatusLabel(document)}
      </p>
      <div className="header-actions">
        <button type="button" className="icon-button" aria-label="Undo" title={`Undo (${UNDO_KEYS.undo})`} disabled={!history.canUndo} onClick={onUndo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-button" aria-label="Redo" title={`Redo (${UNDO_KEYS.redo})`} disabled={!history.canRedo} onClick={onRedo}>
          <Icon name="redo" />
        </button>
        <button type="button" disabled={!document.font} onClick={onOpenExport} title={document.font ? 'Export SVG or a font file' : 'Load a font to export'}>
          <Icon name="download" />
          Export…
        </button>
      </div>
    </header>
  )
}
