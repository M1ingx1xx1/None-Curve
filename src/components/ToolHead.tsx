import type { DocumentState } from '../state/types'
import type { FontImporter } from '../state/useFontImport'
import FontStatus from './FontStatus'
import Icon from './Icon'
import ImportMenu from './ImportMenu'

/** How the last config file import went: applied (with what is left to do), or refused and why. */
export type ConfigNotice = { tone: 'info' | 'error'; text: string }

interface ToolHeadProps {
  document: DocumentState
  importer: FontImporter
  onOpenGoogleFonts: () => void
  onConfigFile: (file: File) => void
  configNotice: ConfigNotice | null
  onDismissConfigNotice: () => void
}

/** Top left, first: font import and font information. */
export default function ToolHead({ document, importer, onOpenGoogleFonts, onConfigFile, configNotice, onDismissConfigNotice }: ToolHeadProps) {
  const dismiss = (
    <button type="button" className="button-small" aria-label="Dismiss" onClick={onDismissConfigNotice}>
      <Icon name="close" />
    </button>
  )
  return (
    <section className="panel tool-head" aria-label="Font">
      <ImportMenu
        busy={document.status.kind === 'loading'}
        onLocalFile={importer.importLocal}
        onOpenGoogleFonts={onOpenGoogleFonts}
        onConfigFile={onConfigFile}
      />
      {configNotice?.tone === 'error' && (
        <div className="font-error config-notice" role="alert">
          <p className="font-error-kind">Config not imported</p>
          <p>{configNotice.text}</p>
          {dismiss}
        </div>
      )}
      {configNotice?.tone === 'info' && (
        <div className="panel-notice config-notice" role="status">
          <p>{configNotice.text}</p>
          {dismiss}
        </div>
      )}
      <FontStatus
        status={document.status}
        font={document.font}
        onRetry={importer.retry}
        onCancel={importer.cancel}
        onFace={importer.selectFace}
      />
    </section>
  )
}
