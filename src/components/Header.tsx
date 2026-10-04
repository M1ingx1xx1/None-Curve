import type { DocumentState } from '../state/types'

interface HeaderProps {
  document: DocumentState
}

function fileStatusLabel(document: DocumentState): string {
  switch (document.status.kind) {
    case 'empty':
      return 'No font loaded'
    case 'loading':
      return `Reading ${document.status.fileName}`
    case 'error':
      return `Failed to read: ${document.status.message}`
    case 'ready':
      return document.font?.fileName ?? 'Loaded'
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
        <button type="button" disabled title="Font import is not implemented yet">
          Import font<span className="pending">Soon</span>
        </button>
        <button type="button" disabled title="Export is not implemented yet">
          Export<span className="pending">Soon</span>
        </button>
      </div>
    </header>
  )
}
