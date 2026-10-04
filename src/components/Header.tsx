import type { DocumentState } from '../state/types'

interface HeaderProps {
  document: DocumentState
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

export default function Header({ document }: HeaderProps) {
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
        <button type="button" disabled title="Export is not implemented yet">
          Export<span className="pending">Soon</span>
        </button>
      </div>
    </header>
  )
}
