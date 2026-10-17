import type { DocumentState } from '../state/types'
import type { FontImporter } from '../state/useFontImport'
import FontStatus from './FontStatus'
import ImportMenu from './ImportMenu'

interface ToolHeadProps {
  document: DocumentState
  importer: FontImporter
  onOpenGoogleFonts: () => void
}

/** Top left, first: font import and font information. */
export default function ToolHead({ document, importer, onOpenGoogleFonts }: ToolHeadProps) {
  return (
    <section className="panel tool-head" aria-label="Font">
      <ImportMenu busy={document.status.kind === 'loading'} onLocalFile={importer.importLocal} onOpenGoogleFonts={onOpenGoogleFonts} />
      <FontStatus status={document.status} font={document.font} onRetry={importer.retry} onCancel={importer.cancel} />
    </section>
  )
}
