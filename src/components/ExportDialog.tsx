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
import { svgToPng } from '../export/png'
import { specimenToSvg, type SvgLook } from '../export/svg'
import { formatCodePoint, glyphLabel, type LoadedFont } from '../font/model'
import { describePipeline } from '../geometry/describe'
import type { GeometryParams, GlyphRef } from '../geometry/types'
import { layoutArtboard, type ArtboardParams, type PaletteParams, type TypographyParams } from '../specimen/artboard'
import { buildSpecimenScene } from '../specimen/scene'
import { previewColors, type PreviewLook } from './TextPreview'

type Format = 'svg' | 'png' | 'otf'


interface ExportDialogProps {
  open: boolean
  onClose: () => void
  font: LoadedFont | null
  selectedGlyph: GlyphRef | null
  specimenText: string
  /** How the text is set on the canvas, its colours, and the canvas size (with the PNG multiplier). */
  typography: TypographyParams
  palette: PaletteParams
  artboard: ArtboardParams
  /** Blur and inversion of the bottom-right preview, and its scale (screen pixels per font unit). */
  previewLook: PreviewLook
  previewScale: number
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
  { value: 'svg', label: 'SVG — main view', hint: 'The canvas with its text, colours, and size, as vector outlines.' },
  { value: 'png', label: 'PNG — main view', hint: 'The canvas as an image, at the size and multiplier set under Canvas size.' },
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
  const { open, onClose, font, selectedGlyph, specimenText, typography, palette, artboard, previewLook, previewScale } = props
  const { params, paramsKey, pending, precision, onPrecisionChange, onExported } = props
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<Format>('svg')
  // Off by default: exports show the main view; ticked, they carry the preview's blur and inversion.
  const [usePreviewLook, setUsePreviewLook] = useState(false)
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

  // The preview's blur is in its own screen pixels; dividing by its scale gives font units, and by the
  // canvas's font units per pixel gives canvas pixels, so the blur keeps its size relative to the letters.
  const look = (unitsPerPx: number): SvgLook => {
    const background = !palette.transparent
    if (!usePreviewLook) return { ink: palette.ink, paper: palette.paper, background, blur: 0 }
    const blurUnits = previewScale > 0 ? previewLook.blur / previewScale : 0
    return { ...previewColors(palette, previewLook), background, blur: blurUnits / unitsPerPx }
  }
  const pngWidth = artboard.width * artboard.scale
  const pngHeight = artboard.height * artboard.scale
  const lookName = usePreviewLook
    ? `preview look (${previewLook.blur > 0 ? `blur ${previewLook.blur} px` : 'no blur'}${previewLook.inverted ? ', inverted' : ''})`
    : 'main view'

  const exportImage = async () => {
    if (!font) return
    const forPng = format === 'png'
    try {
      const { tracking, lineHeight, align, slant } = typography
      const scene = buildSpecimenScene(font, specimenText, params, paramsKey, { tracking, lineHeight, align, slant })
      const layout = layoutArtboard(scene, typography, artboard, font.metrics.unitsPerEm)
      const subject = `${usePreviewLook ? 'preview' : 'main view'} “${specimenText.slice(0, 80)}”`
      // PNG coordinates only need to be sharp at the chosen pixel size; two decimals is plenty.
      const size = { width: artboard.width, height: artboard.height }
      const svg = specimenToSvg(scene, layout, size, forPng ? 2 : precision, { fontName, subject, pipeline }, look(layout.unitsPerPx))
      const parts = [font.familyName, font.styleName, usePreviewLook ? 'preview' : 'text']
      if (!forPng) {
        const fileName = safeFileName(parts, 'svg')
        downloadFile(svg.svg, fileName, 'image/svg+xml')
        setStatus({ kind: 'done', message: `Saved ${fileName}: ${svg.paths} outline${svg.paths === 1 ? '' : 's'}, ${svg.vertices} vertices, ${lookName}.` })
        onExported(fileName)
        return
      }
      setStatus({ kind: 'working', message: 'Drawing the PNG…' })
      const png = await svgToPng(svg.svg, size.width, size.height, pngWidth)
      const fileName = safeFileName(parts, 'png')
      downloadFile(png, fileName, 'image/png')
      setStatus({ kind: 'done', message: `Saved ${fileName}: ${pngWidth} × ${pngHeight} px, ${lookName}.` })
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
                <div className="field field-toggle">
                  <input
                    id="export-preview-look"
                    type="checkbox"
                    checked={usePreviewLook}
                    aria-describedby="export-preview-look-hint"
                    onChange={(e) => setUsePreviewLook(e.target.checked)}
                  />
                  <label htmlFor="export-preview-look">Export the preview look</label>
                </div>
                <p id="export-preview-look-hint" className="field-hint">
                  Off: the main view — the canvas in its Color settings. On: the bottom-right preview’s current look —{' '}
                  {previewLook.blur > 0 ? `blur ${previewLook.blur} px` : 'no blur'}, {previewLook.inverted ? 'colours swapped' : 'same colours'}. The
                  blur keeps its size relative to the letters{format === 'svg' ? ' and is stored as an SVG blur filter' : ''}.
                </p>
                {palette.transparent && (
                  <p className="field-hint">
                    Transparent background (set in Color): only the text is drawn{format === 'png' ? ' (PNG with transparency)' : ''}.
                  </p>
                )}

                {format === 'svg' ? (
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
                      The file is {artboard.width} × {artboard.height} px. Outline coordinates are kept in font units and placed
                      with transforms; if rounding would collapse, flip, or cross a contour, the export stops and asks for a
                      higher precision.
                    </p>
                  </div>
                ) : (
                  <p className="field-hint">
                    Image size: {pngWidth} × {pngHeight} px (canvas {artboard.width} × {artboard.height} px at {artboard.scale}×). Change it
                    under Canvas size, below the canvas.
                  </p>
                )}
                <p className="export-summary">
                  Text: “{specimenText.slice(0, 60)}
                  {specimenText.length > 60 ? '…' : ''}” · {lookName}
                  {format === 'svg' ? ' · SVG paths use only M, L, and Z with nonzero fill.' : ''}
                </p>
                <button type="button" className="button-primary" disabled={pending || working || !specimenText.trim()} onClick={exportImage}>
                  {format === 'svg' ? 'Download SVG' : 'Download PNG'}
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
