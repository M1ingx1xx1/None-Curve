import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { downloadFile, safeFileName } from '../export/download'
import { FONT_BOX_LIMITS } from '../export/fitGlyph'
import { runFontExport } from '../export/fontExportClient'
import {
  FONT_EXPORT_LIMITS,
  MAX_EXPORT_POINTS,
  planFontExport,
  reservedFontNames,
  validateNaming,
  type FontExportPlan,
  type FontExportResult,
  type FontExportStage,
  type FontNaming,
  type GlyphSet,
  type KnownGlyph,
} from '../export/fontFile'
import { pngSize, svgToPng } from '../export/png'
import { getRecorder, useRecording } from '../export/recorder'
import { OUTLINE_STROKE_PX, specimenToSvg, type SvgLook } from '../export/svg'
import { formatCodePoint, glyphLabel, type LoadedFont } from '../font/model'
import { describePipeline } from '../geometry/describe'
import type { GeometryParams, GlyphRef } from '../geometry/types'
import { useLiveStatus } from '../sound/live'
import { layoutArtboard, type ArtboardParams, type PaletteParams, type TypographyParams } from '../specimen/artboard'
import { placePolygons, shapeSpecimen } from '../specimen/scene'
import { geometryClient } from '../state/geometryClient'
import { serializeConfig, type SavedFont, type Session } from '../state/persist'
import { previewBlur, previewColors, type PreviewLook } from '../specimen/previewLook'
import Icon from './Icon'
import { RecordOptionsFields, useStillVideo } from './RecordControls'

type Format = 'svg' | 'png' | 'otf' | 'video' | 'config'

/** Above this many outline points still to compute, the build may take minutes (heavy settings: about 5,000 points a second). */
const SLOW_EXPORT_POINTS = 300_000

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
  /** The canvas's Fill: off, the SVG, PNG and video draw outlines only (the font file is always filled). */
  fill: boolean
  params: GeometryParams
  paramsKey: string
  pending: boolean
  precision: number
  onPrecisionChange: (precision: number) => void
  /** Everything the config file holds: the session as it would be saved now. */
  readConfig: () => Session
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
  { value: 'otf', label: 'Font file — OpenType (.otf)', hint: 'A font with polygon outlines, verified before download. Always filled.' },
  { value: 'video', label: 'Video — live sound', hint: 'Records the canvas as it moves with the sound, in real time, with its audio.' },
  { value: 'config', label: 'Config — settings (.json)', hint: 'Every setting, the text, Sound and the font’s name, to load again with Import → Config file.' },
]

/** The font a config names, as the dialog describes it. */
function configFontLine(font: SavedFont | null): string {
  if (!font) return 'No font: importing it keeps the font that is open.'
  if (font.kind === 'local') return `Font: the local file ${font.fileName}, named only. Import that file again after the config.`
  return `Font: ${font.family} ${font.weight}${font.italic ? ' italic' : ''} from Google Fonts, downloaded again on import.`
}

/** The canvas's results for the plan's glyphs under these settings, which the build uses as they are. */
function knownGlyphs(font: LoadedFont, plan: FontExportPlan, key: string): Map<number, KnownGlyph> {
  const known = new Map<number, KnownGlyph>()
  if (!geometryClient.holds(font.id)) return known
  for (const { index } of plan.glyphs) {
    const found = geometryClient.lookup(key, index)
    if (!found || found.stale) continue
    const { entry } = found
    // A glyph the geometry worker never got to (it stopped) is computed by the build instead.
    if ('geometry' in entry) known.set(index, { polygon: entry.geometry.polygon })
    else if (!entry.transient) known.set(index, { error: entry.error })
  }
  return known
}

/**
 * Outline points the file is likely to have: the glyphs computed for these settings so far, and their
 * mean (or the mean of everything computed for them) for the glyphs still to compute. Null without results.
 */
function estimateExport(font: LoadedFont, plan: FontExportPlan, key: string) {
  if (!geometryClient.holds(font.id)) return null
  let known = 0
  let points = 0
  let toCompute = 0
  for (const { index } of plan.glyphs) {
    const found = geometryClient.lookup(key, index)
    const entry = found && !found.stale ? found.entry : null
    if (entry && 'geometry' in entry) {
      known++
      points += entry.geometry.vertexCount
    } else if (!entry || entry.transient) {
      toCompute++
    }
  }
  const mean = known ? points / known : geometryClient.meanVertexCount(key)
  if (mean === null) return null
  return { points: Math.round(points + mean * toCompute), toCompute, pointsToCompute: mean * toCompute }
}

/**
 * The Video format: the take's options (shared with the Sound tab's Record group) and Record, which closes the
 * dialog and starts the take. The header shows it running, with Stop; opened again during the take (the header
 * is out of reach behind the dialog), the dialog has its own Stop, and then shows how the take ended.
 */
function VideoExport({ artboard, transparent, fill, onRecord }: { artboard: ArtboardParams; transparent: boolean; fill: boolean; onRecord: () => void }) {
  const { phase, message } = useRecording()
  const still = useStillVideo()
  const blockerId = useId()
  const idle = phase === 'idle'
  // The recorder re-renders this when the reason changes (a font, a file, the sound opening).
  const blocked = idle ? getRecorder().blocker() : null
  return (
    <div className="export-section">
      <RecordOptionsFields artboard={artboard} transparent={transparent} />
      <PaintNote format="video" fill={fill} />
      {still && <p className="font-warning">Sound is not moving the letters: the video will be still.</p>}
      {blocked !== null && (
        <p id={blockerId} className="font-warning">
          {blocked}
        </p>
      )}
      {idle && message && (
        <p className={message.tone === 'info' ? 'panel-notice record-message' : 'font-warning record-message'} data-tone={message.tone}>
          {message.text}
        </p>
      )}
      <div className="export-actions">
        {idle ? (
          <button type="button" className="button-primary" disabled={blocked !== null} aria-describedby={blocked !== null ? blockerId : undefined} onClick={onRecord}>
            <Icon name="record" />
            Record
          </button>
        ) : (
          // aria-disabled, not disabled: keeps keyboard focus while the file is saved.
          <button
            type="button"
            className="button-primary"
            aria-disabled={phase === 'stopping' || undefined}
            onClick={() => getRecorder().stop('user')}
          >
            <Icon name="stop" />
            Stop
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Whether this export fills the letters or draws outlines only, which follows the canvas's Fill for the
 * SVG, PNG and video; a font file is always filled.
 */
function PaintNote({ format, fill }: { format: Format; fill: boolean }) {
  if (format === 'otf') {
    return (
      <p className="field-hint">
        A font file is always filled{fill ? '' : ': Fill, off on the canvas, only changes the SVG, PNG and video'}.
      </p>
    )
  }
  return fill ? (
    <p className="field-hint">Fill is on: the letters are filled.</p>
  ) : (
    <p className="panel-notice">
      Fill is off on the canvas: outlines only, {OUTLINE_STROKE_PX} px strokes in the text colour with no fill. Turn Fill on
      in the canvas toolbar for filled letters.
    </p>
  )
}

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
  const { open, onClose, font, selectedGlyph, specimenText, typography, palette, artboard, previewLook, previewScale, fill } = props
  const { params, paramsKey, pending, precision, onPrecisionChange, readConfig, onExported } = props
  // While Sound drives the letters the canvas shows live shapes, but exports use the sliders (SOUND_PLAN §9).
  const { driving: soundLive } = useLiveStatus()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const [chosen, setFormat] = useState<Format>('svg')
  // Without a font only the config can be saved.
  const format: Format = font ? chosen : 'config'
  // Off by default: exports show the main view; ticked, they carry the preview's blur and inversion.
  const [usePreviewLook, setUsePreviewLook] = useState(false)
  const [glyphSet, setGlyphSet] = useState<GlyphSet>('specimen')
  const [naming, setNaming] = useState<FontNaming>({ familyName: '', styleName: '' })
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [built, setBuilt] = useState<BuiltFont | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Results that arrive while the dialog is open refine the estimate.
  useSyncExternalStore(geometryClient.subscribe, geometryClient.getVersion)

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
    // A leading dot (Apple's hidden system fonts) would hide the exported font from font menus too.
    if (font) setNaming({ familyName: `${font.familyName} Poly`.replace(/[^\x20-\x7E]/g, '').replace(/^\.+/, '').slice(0, 63).trim() || 'None Curve Poly', styleName: (font.styleName || 'Regular').replace(/[^\x20-\x7E]/g, '').slice(0, 63).trim() || 'Regular' })
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
  const estimate = open && font && plan && format === 'otf' ? estimateExport(font, plan, paramsKey) : null
  const namingError = validateNaming(naming)
  // SIL OFL "Reserved Font Name": a modified version must not use it.
  const reservedClash = font
    ? reservedFontNames(font).find((name) => naming.familyName.toLowerCase().includes(name.toLowerCase())) ?? null
    : null
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

  // The preview's blur keeps its size relative to the letters (previewBlur).
  const look = (unitsPerPx: number): SvgLook => {
    const background = !palette.transparent
    const outlineOnly = !fill
    if (!usePreviewLook) return { ink: palette.ink, paper: palette.paper, background, blur: 0, outlineOnly }
    return { ...previewColors(palette, previewLook), background, blur: previewBlur(previewLook.blur, previewScale, unitsPerPx), outlineOnly }
  }
  const { width: pngWidth, height: pngHeight, capped: pngCapped } = pngSize(artboard.width, artboard.height, artboard.scale)
  const lookName = `${
    usePreviewLook
      ? `preview look (${previewLook.blur > 0 ? `blur ${previewLook.blur} px` : 'no blur'}${previewLook.inverted ? ', inverted' : ''})`
      : 'main view'
  }${fill ? '' : ', outlines only'}`

  const exportImage = async () => {
    if (!font) return
    const forPng = format === 'png'
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { tracking, lineHeight, align, slant } = typography
      // The canvas's polygons; glyphs not computed yet for these settings are computed in the geometry worker first.
      const shaped = shapeSpecimen(font, specimenText, { tracking, lineHeight, align, slant })
      if (shaped.indices.some((index) => !geometryClient.lookup(paramsKey, index) || geometryClient.lookup(paramsKey, index)!.stale)) {
        setStatus({ kind: 'working', message: 'Computing outlines…' })
      }
      const lookup = await geometryClient.ensure(font, params, paramsKey, shaped.indices, controller.signal)
      const scene = placePolygons(shaped, lookup)
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
      controller.signal.throwIfAborted()
      const fileName = safeFileName(parts, 'png')
      downloadFile(png, fileName, 'image/png')
      setStatus({ kind: 'done', message: `Saved ${fileName}: ${pngWidth} × ${pngHeight} px, ${lookName}.` })
      onExported(fileName)
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

  const buildFont = async () => {
    if (!font || !plan) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBuilt(null)
    setStatus({ kind: 'working', message: 'Preparing…' })
    try {
      // In a worker of its own, which Cancel stops at once; the glyphs the canvas has are used as they are.
      const onProgress = (done: number, total: number, stage: FontExportStage) => {
        if (controller.signal.aborted) return
        const label = stage === 'outlines' ? `Processing outlines ${done} / ${total}` : stage === 'writing' ? 'Writing the font…' : 'Verifying with fontkit…'
        setStatus({ kind: 'working', message: label })
      }
      const known = knownGlyphs(font, plan, paramsKey)
      const result = await runFontExport({ font, plan, params, key: paramsKey, naming, known, onProgress }, controller.signal)
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

  const exportConfig = () => {
    const config = readConfig()
    const family = font?.familyName ?? (config.font?.kind === 'google' ? config.font.family : '')
    const fileName = safeFileName(['none-curve', family, 'config'], 'json')
    downloadFile(serializeConfig(config), fileName, 'application/json')
    setStatus({ kind: 'done', message: `Saved ${fileName}.` })
    onExported(fileName)
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

  const configSection = (
    <div className="export-section">
      <p className="field-hint">
        The settings, the canvas view’s buttons, the text, the preview look, the coordinate precision, the Sound mappings and
        Response, and the selected glyph. {configFontLine(format === 'config' && open ? readConfig().font : null)}
      </p>
      <div className="export-actions">
        <button type="button" className="button-primary" onClick={exportConfig}>
          Download config
        </button>
      </div>
    </div>
  )

  const statusLine = (
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
  )

  return (
    <dialog ref={dialogRef} className="gf-dialog export-dialog" aria-labelledby="export-title" onClose={close} onCancel={(e) => { e.preventDefault(); close() }}>
      <div className="gf-body">
        <header className="gf-head">
          <h2 id="export-title">Export</h2>
          <button type="button" className="button-small" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        {!font ? (
          <>
            <p className="gf-intro">Load a font to export SVG, PNG, a font file or a video. The config can be saved without one.</p>
            {configSection}
            {statusLine}
          </>
        ) : (
          <>
            <p className="gf-intro">
              Exports use the final polygons shown on the canvas: {fontName}, pipeline {pipeline.join(' → ')}.{' '}
              {format === 'video' ? 'The video is saved when the take ends.' : 'Nothing is downloaded until you press the download button.'}
            </p>
            {soundLive && format !== 'video' && (
              <p className="font-warning">Sound is moving the letters: exports use the sliders. To export the live look, press Freeze.</p>
            )}

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

            {pending && format !== 'video' && format !== 'config' && <p className="font-warning">Parameters are still updating; export waits for the latest result.</p>}

            {(format === 'svg' || format === 'png') && (
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
                <PaintNote format={format} fill={fill} />
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
                      with transforms. Rounding is repaired where it can be; if a contour would still collapse or cross
                      itself, the export stops and asks for a higher precision.
                    </p>
                  </div>
                ) : (
                  <p className="field-hint">
                    Image size: {pngWidth} × {pngHeight} px (canvas {artboard.width} × {artboard.height} px at {artboard.scale}×
                    {pngCapped ? ', scaled down to what a browser can draw' : ''}). Change it under Canvas size,
                    below the canvas.
                  </p>
                )}
                <p className="export-summary">
                  Text: “{specimenText.slice(0, 60)}
                  {specimenText.length > 60 ? '…' : ''}” · {lookName}
                  {format === 'svg' ? (fill ? ' · SVG paths use only M, L, and Z with nonzero fill.' : ' · SVG paths use only M, L, and Z, stroked with no fill.') : ''}
                </p>
                <div className="export-actions">
                  <button type="button" className="button-primary" disabled={pending || working || !specimenText.trim()} onClick={exportImage}>
                    {format === 'svg' ? 'Download SVG' : 'Download PNG'}
                  </button>
                  {working && (
                    <button type="button" onClick={() => abortRef.current?.abort()}>
                      Cancel
                    </button>
                  )}
                </div>
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
                {reservedClash && (
                  <p className="font-warning">
                    The source font’s license reserves the name “{reservedClash}”: a modified version must use a different
                    family name.
                  </p>
                )}
                <PaintNote format="otf" fill={fill} />
                <p className="export-summary">
                  {plan.glyphs.length} glyph{plan.glyphs.length === 1 ? '' : 's'} plus .notdef, every one processed with the
                  current pipeline.
                  {font.axes.length > 0 && ` Variable font: the instance shown on the canvas (${font.instance ? Object.entries(font.instance).map(([tag, value]) => `${tag} ${value}`).join(', ') : 'default'}) is exported.`}
                  {estimate && ` About ${estimate.points.toLocaleString('en-US')} outline points.`}
                </p>
                {estimate && estimate.points > MAX_EXPORT_POINTS && (
                  <p className="font-warning">
                    That is more than the {MAX_EXPORT_POINTS.toLocaleString('en-US')} a font file can hold. Use a larger Anchor spacing,
                    weaker Experimental effects, or the specimen characters.
                  </p>
                )}
                {estimate && estimate.points <= MAX_EXPORT_POINTS && estimate.pointsToCompute > SLOW_EXPORT_POINTS && (
                  <p className="font-warning">
                    {estimate.toCompute} glyphs still need computing at these settings: the build may take minutes.
                  </p>
                )}
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
                    <Icon name="download" />
                    Download .otf
                  </button>
                </div>
                {currentBuild && (
                  <div className="export-result" role="status">
                    <p>
                      Verified {currentBuild.fileName}: {currentBuild.result.glyphCount} glyphs, {currentBuild.result.characterCount} characters,{' '}
                      {currentBuild.result.contourCount} contours. Reopened with fontkit (mappings, advances,
                      {currentBuild.result.kerning ? ' kerning,' : ''} line spacing, every contour point and direction) and accepted by the
                      browser’s font engine.
                    </p>
                    {currentBuild.result.excluded.length > 0 && (
                      <p className="font-warning">
                        Left out of the font file:{' '}
                        {currentBuild.result.excluded.slice(0, 8).map((e) => `${e.label} (${e.reason})`).join('; ')}
                        {currentBuild.result.excluded.length > 8 ? `; and ${currentBuild.result.excluded.length - 8} more` : ''}.
                      </p>
                    )}
                    {currentBuild.result.trimmed.length > 0 && (
                      <p className="font-warning">
                        Trimmed to fit: a font stores each glyph within a square 32,766 font units across (
                        {Number((FONT_BOX_LIMITS.span / font.metrics.unitsPerEm).toFixed(1))} em for this font). Outline parts reaching further, such as long Thorn tips, were cut off at
                        its edge in {currentBuild.result.trimmed.slice(0, 8).join(', ')}
                        {currentBuild.result.trimmed.length > 8 ? `; and ${currentBuild.result.trimmed.length - 8} more` : ''}. Only the font file is
                        trimmed: the canvas, SVG and PNG are not.
                      </p>
                    )}
                  </div>
                )}
                {built && !currentBuild && <p className="field-hint">Settings changed since the last build. Build again to download.</p>}
              </div>
            )}

            {format === 'video' && (
              <VideoExport
                artboard={artboard}
                transparent={palette.transparent}
                fill={fill}
                onRecord={() => {
                  // In the same click: the dialog closes and the take starts the sound (play() needs the click).
                  close()
                  getRecorder().start()
                }}
              />
            )}

            {format === 'config' && configSection}
            {statusLine}
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
