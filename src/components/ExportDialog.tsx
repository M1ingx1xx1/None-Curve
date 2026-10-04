import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadFile, safeFileName } from '../export/download'
import {
  buildFontFile,
  FONT_EXPORT_LIMITS,
  planFontExport,
  validateNaming,
  type FontExportResult,
  type FontNaming,
  type GlyphSet,
} from '../export/fontFile'
import { glyphToSvg, specimenToSvg } from '../export/svg'
import { formatCodePoint, glyphLabel, type LoadedFont } from '../font/model'
import { glyphGeometry } from '../geometry/cache'
import { describePipeline } from '../geometry/describe'
import type { GeometryParams, GlyphRef } from '../geometry/types'
import { buildSpecimenScene } from '../specimen/scene'

type Format = 'glyph-svg' | 'specimen-svg' | 'otf'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  font: LoadedFont | null
  selectedGlyph: GlyphRef | null
  specimenText: string
  params: GeometryParams
  paramsKey: string
  pending: boolean
  precision: number
  onPrecisionChange: (precision: number) => void
  onExported: (fileName: string) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

type BuiltFont = { result: FontExportResult; key: string; fileName: string }

const formats: { value: Format; label: string; hint: string }[] = [
  { value: 'glyph-svg', label: 'SVG — current glyph', hint: 'The selected glyph as shown on the canvas.' },
  { value: 'specimen-svg', label: 'SVG — specimen text', hint: 'The specimen text, laid out with advances and kerning.' },
  { value: 'otf', label: 'Font file — OpenType (.otf)', hint: 'A font with polygon outlines, verified before download.' },
]

/** Loads the font through the browser's own font engine (OTS sanitizer in Chrome and Firefox). */
async function browserAcceptsFont(bytes: ArrayBuffer): Promise<boolean> {
  if (typeof FontFace === 'undefined') return true
  try {
    await new FontFace('none-curve-export-check', bytes).load()
    return true
  } catch {
    return false
  }
}

export default function ExportDialog(props: ExportDialogProps) {
  const { open, onClose, font, selectedGlyph, specimenText, params, paramsKey, pending, precision, onPrecisionChange, onExported } = props
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<Format>('glyph-svg')
  const [glyphSet, setGlyphSet] = useState<GlyphSet>('specimen')
  const [naming, setNaming] = useState<FontNaming>({ familyName: '', styleName: '' })
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [built, setBuilt] = useState<BuiltFont | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      firstRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  // New font: suggest a derived name (many licenses require renaming modified fonts).
  useEffect(() => {
    if (font) setNaming({ familyName: `${font.familyName} Poly`.replace(/[^\x20-\x7E]/g, '').slice(0, 63).trim() || 'None Curve Poly', styleName: (font.styleName || 'Regular').replace(/[^\x20-\x7E]/g, '').slice(0, 63).trim() || 'Regular' })
  }, [font])

  // Abort a running build when the dialog closes or the component unmounts.
  useEffect(() => {
    if (!open) abortRef.current?.abort()
  }, [open])
  useEffect(() => () => abortRef.current?.abort(), [])

  const plan = useMemo(
    () => (font ? planFontExport(font, glyphSet, selectedGlyph, specimenText) : null),
    [font, glyphSet, selectedGlyph, specimenText],
  )
  const buildKey = `${font?.id}|${paramsKey}|${glyphSet}|${glyphSet === 'current' ? selectedGlyph?.index : glyphSet === 'specimen' ? specimenText : ''}|${naming.familyName}|${naming.styleName}`
  const currentBuild = built && built.key === buildKey ? built : null
  const namingError = validateNaming(naming)
  const working = status.kind === 'working'

  const close = () => {
    abortRef.current?.abort()
    onClose()
  }

  const fontName = font ? `${font.familyName} ${font.styleName}` : ''
  const pipeline = describePipeline(params)
  const glyphName = selectedGlyph
    ? `${glyphLabel(selectedGlyph)}${selectedGlyph.unicode !== null ? ` (${formatCodePoint(selectedGlyph.unicode)})` : ''}`
    : 'none'

  const exportSvg = () => {
    if (!font) return
    try {
      let svg
      let fileName
      if (format === 'glyph-svg') {
        if (!selectedGlyph) throw new Error('Select a glyph first.')
        const geometry = glyphGeometry(font, selectedGlyph.index, params, paramsKey)
        svg = glyphToSvg(geometry.polygon, geometry.polygon.metrics, precision, { fontName, subject: `glyph ${glyphName}`, pipeline })
        const id = selectedGlyph.unicode !== null ? formatCodePoint(selectedGlyph.unicode).replace('+', '') : selectedGlyph.name || `glyph${selectedGlyph.index}`
        fileName = safeFileName([font.familyName, font.styleName, id], 'svg')
      } else {
        const scene = buildSpecimenScene(font, specimenText, params, paramsKey)
        svg = specimenToSvg(scene, precision, { fontName, subject: `specimen “${specimenText.slice(0, 80)}”`, pipeline })
        fileName = safeFileName([font.familyName, font.styleName, 'specimen'], 'svg')
      }
      downloadFile(svg.svg, fileName, 'image/svg+xml')
      setStatus({ kind: 'done', message: `Saved ${fileName}: ${svg.paths} outline${svg.paths === 1 ? '' : 's'}, ${svg.vertices} vertices.` })
      onExported(fileName)
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const buildFont = async () => {
    if (!font || !plan) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBuilt(null)
    setStatus({ kind: 'working', message: 'Preparing…' })
    try {
      const result = await buildFontFile(font, plan, params, paramsKey, naming, controller.signal, (done, total, stage) => {
        const label = stage === 'outlines' ? `Processing outlines ${done} / ${total}` : stage === 'writing' ? 'Writing the font…' : 'Verifying with fontkit…'
        setStatus({ kind: 'working', message: label })
      })
      setStatus({ kind: 'working', message: 'Checking with the browser font engine…' })
      if (!(await browserAcceptsFont(result.bytes))) {
        throw new Error('The browser’s font engine rejected the generated file, so it is not offered for download.')
      }
      if (controller.signal.aborted) return
      setBuilt({ result, key: buildKey, fileName: safeFileName([naming.familyName, naming.styleName], 'otf') })
      setStatus({ kind: 'idle' })
    } catch (error) {
      if (controller.signal.aborted) {
        setStatus({ kind: 'cancelled' })
        return
      }
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const downloadFont = () => {
    if (!currentBuild) return
    downloadFile(currentBuild.result.bytes, currentBuild.fileName, 'font/otf')
    setStatus({ kind: 'done', message: `Saved ${currentBuild.fileName}.` })
    onExported(currentBuild.fileName)
  }

  const counts: Record<GlyphSet, string> = {
    current: selectedGlyph ? `1 glyph (${glyphName})` : 'no glyph selected',
    specimen: font ? `${new Set([...specimenText].filter((c) => c !== '\n' && c !== '\r')).size} distinct characters` : '',
    all: font ? `${font.characters.length} characters` : '',
  }

  return (
    <dialog ref={dialogRef} className="gf-dialog export-dialog" aria-labelledby="export-title" onClose={close} onCancel={(e) => { e.preventDefault(); close() }}>
      <div className="gf-body">
        <header className="gf-head">
          <h2 id="export-title">Export</h2>
          <button type="button" className="button-small" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>

        {!font ? (
          <p className="gf-intro">Load a font first.</p>
        ) : (
          <>
            <p className="gf-intro">
              Exports use the final polygons shown on the canvas: {fontName}, pipeline {pipeline.join(' → ')}. Nothing is
              downloaded until you press the download button.
            </p>

            <fieldset className="export-formats">
              <legend>Format</legend>
              {formats.map((f, i) => (
                <label key={f.value} className="export-format">
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    type="radio"
                    name="export-format"
                    value={f.value}
                    checked={format === f.value}
                    onChange={() => {
                      setFormat(f.value)
                      setStatus({ kind: 'idle' })
                    }}
                  />
                  <span>
                    <strong>{f.label}</strong>
                    <span className="field-hint">{f.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {pending && <p className="font-warning">Parameters are still updating; export waits for the latest result.</p>}

            {format !== 'otf' && (
              <div className="export-section">
                <div className="field">
                  <label htmlFor="export-precision">Coordinate precision</label>
                  <select id="export-precision" value={precision} onChange={(e) => onPrecisionChange(Number(e.target.value))}>
                    {[0, 1, 2, 3, 4].map((p) => (
                      <option key={p} value={p}>
                        {p === 0 ? 'Whole font units' : `${p} decimal place${p === 1 ? '' : 's'}`}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">
                    Coordinates are font units. If rounding would collapse, flip, or cross a contour, the export stops
                    and asks for a higher precision.
                  </p>
                </div>
                <p className="export-summary">
                  {format === 'glyph-svg' ? `Glyph ${glyphName}` : `Specimen: “${specimenText.slice(0, 60)}${specimenText.length > 60 ? '…' : ''}”`} ·
                  SVG paths use only M, L, and Z with nonzero fill.
                </p>
                <button
                  type="button"
                  className="button-primary"
                  disabled={pending || (format === 'glyph-svg' ? !selectedGlyph : !specimenText.trim())}
                  onClick={exportSvg}
                >
                  Download SVG
                </button>
              </div>
            )}

            {format === 'otf' && plan && (
              <div className="export-section">
                <fieldset className="export-formats">
                  <legend>Glyphs to include</legend>
                  {(['current', 'specimen', 'all'] as GlyphSet[]).map((set) => (
                    <label key={set} className="export-format">
                      <input type="radio" name="export-glyphs" value={set} checked={glyphSet === set} onChange={() => setGlyphSet(set)} />
                      <span>
                        <strong>{set === 'current' ? 'Current glyph' : set === 'specimen' ? 'Specimen characters' : 'All mapped characters'}</strong>
                        <span className="field-hint">{counts[set]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="export-names">
                  <div className="field">
                    <label htmlFor="export-family">Family name</label>
                    <input id="export-family" type="text" value={naming.familyName} onChange={(e) => setNaming({ ...naming, familyName: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="export-style">Style name</label>
                    <input id="export-style" type="text" value={naming.styleName} onChange={(e) => setNaming({ ...naming, styleName: e.target.value })} />
                  </div>
                </div>
                {namingError && <p className="font-warning">{namingError}</p>}
                <p className="export-summary">
                  {plan.glyphs.length} glyph{plan.glyphs.length === 1 ? '' : 's'} plus .notdef, every one processed with the
                  current pipeline.
                  {font.axes.length > 0 && ' Variable font: the default instance shown on the canvas is exported.'}
                </p>
                {plan.missing.length > 0 && <p className="font-warning">Not in this font, left out: {plan.missing.join(' ')}</p>}
                {plan.unsupported.length > 0 && (
                  <p className="font-warning">Above U+FFFF, left out: {plan.unsupported.slice(0, 12).join(' ')}{plan.unsupported.length > 12 ? ' …' : ''}</p>
                )}
                {plan.problems.map((p) => (
                  <p key={p} className="font-warning">{p}</p>
                ))}
                <details className="export-limits">
                  <summary>What the font file does not include</summary>
                  <ul>
                    {FONT_EXPORT_LIMITS.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </details>

                <div className="export-actions">
                  <button type="button" disabled={working || pending || plan.problems.length > 0 || Boolean(namingError)} onClick={buildFont}>
                    Build &amp; verify
                  </button>
                  {working && (
                    <button type="button" onClick={() => abortRef.current?.abort()}>
                      Cancel
                    </button>
                  )}
                  <button type="button" className="button-primary" disabled={!currentBuild || working} onClick={downloadFont}>
                    Download .otf
                  </button>
                </div>
                {currentBuild && (
                  <div className="export-result" role="status">
                    <p>
                      Verified {currentBuild.fileName}: {currentBuild.result.glyphCount} glyphs, {currentBuild.result.characterCount} characters,{' '}
                      {currentBuild.result.contourCount} contours. Reopened with fontkit (mappings, advances, every contour point and
                      direction) and accepted by the browser’s font engine.
                    </p>
                    {currentBuild.result.excluded.length > 0 && (
                      <p className="font-warning">
                        Left out because their outline could not be stored safely at whole units:{' '}
                        {currentBuild.result.excluded.slice(0, 8).map((e) => `${e.label} (${e.reason})`).join('; ')}
                        {currentBuild.result.excluded.length > 8 ? `; and ${currentBuild.result.excluded.length - 8} more` : ''}.
                      </p>
                    )}
                  </div>
                )}
                {built && !currentBuild && <p className="field-hint">Settings changed since the last build. Build again to download.</p>}
              </div>
            )}

            <div className="export-status" aria-live="polite">
              {status.kind === 'working' && (
                <p className="gf-placeholder">
                  <span className="spinner" aria-hidden="true" />
                  {status.message}
                </p>
              )}
              {status.kind === 'done' && <p className="export-done">{status.message}</p>}
              {status.kind === 'cancelled' && <p className="field-hint">Export cancelled.</p>}
              {status.kind === 'error' && (
                <div className="font-error" role="alert">
                  <p className="font-error-kind">Export failed</p>
                  <p>{status.message}</p>
                </div>
              )}
            </div>
          </>
        )}

        <footer className="gf-foot">
          <button type="button" onClick={close}>
            Close
          </button>
        </footer>
      </div>
    </dialog>
  )
}
