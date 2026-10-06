import { errorKindLabel } from '../font/errors'
import type { LoadedFont } from '../font/model'
import type { LoadStatus } from '../state/types'
import Icon from './Icon'

interface FontStatusProps {
  status: LoadStatus
  font: LoadedFont | null
  onRetry: () => void
  onCancel: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function sourceLine(font: LoadedFont): string {
  const { source } = font
  if (source.kind === 'local') return `Local file · ${source.fileName} · ${formatBytes(source.byteSize)}`
  const style = `${source.weight}${source.italic ? ' italic' : ''}`
  const version = source.version ? ` · ${source.version}` : ''
  return `Google Fonts · ${style} · ${source.subset} subset${version} · ${formatBytes(source.byteSize)}`
}

function FontSummary({ font }: { font: LoadedFont }) {
  return (
    <div className="font-summary">
      <p className="font-name">
        {font.familyName} <span className="font-style">{font.styleName}</span>
      </p>
      <p className="font-meta">{sourceLine(font)}</p>
      <dl className="font-facts">
        <div>
          <dt>Format</dt>
          <dd>{font.format.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Glyphs</dt>
          <dd>{font.glyphCount}</dd>
        </div>
        <div>
          <dt>Characters</dt>
          <dd>{font.characters.length}</dd>
        </div>
        <div>
          <dt>Units/em</dt>
          <dd>{font.metrics.unitsPerEm}</dd>
        </div>
      </dl>
      {font.characters.length === 0 && (
        <p className="font-warning">This font has no Unicode mapping. Browse it with “All glyphs”.</p>
      )}
      {font.axes.length > 0 && (
        <div className="font-axes">
          <p className="font-axes-title">Variable axes</p>
          <ul>
            {font.axes.map((axis) => (
              <li key={axis.tag}>
                <code>{axis.tag}</code> {axis.name} · {axis.min}–{axis.max} (default {axis.default})
              </li>
            ))}
          </ul>
          <p className="font-warning">
            Outlines show the default instance. Choosing axis values is not supported yet.
          </p>
        </div>
      )}
    </div>
  )
}

export default function FontStatus({ status, font, onRetry, onCancel }: FontStatusProps) {
  return (
    <section className="font-status" aria-label="Font" aria-live="polite" data-state={status.kind}>
      {status.kind === 'empty' && (
        <p className="font-empty">No font loaded. Import a local font file or load one from Google Fonts.</p>
      )}

      {status.kind === 'loading' && (
        <div className="font-loading">
          <p>
            <span className="spinner" aria-hidden="true" />
            {status.label}…
          </p>
          <button type="button" className="button-small" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="font-error" role="alert">
          <p className="font-error-kind">{errorKindLabel[status.errorKind]}</p>
          <p>{status.message}</p>
          <div className="font-error-actions">
            <button type="button" className="button-small" onClick={onRetry}>
              <Icon name="retry" />
              Retry
            </button>
            {font && <span className="font-meta">Still showing {font.familyName}.</span>}
          </div>
        </div>
      )}

      {font && status.kind !== 'error' && <FontSummary font={font} />}
    </section>
  )
}
