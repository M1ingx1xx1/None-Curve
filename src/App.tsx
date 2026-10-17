import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import CanvasViewport from './components/CanvasViewport'
import ExportDialog from './components/ExportDialog'
import GeometryPanel from './components/GeometryPanel'
import GoogleFontsDialog from './components/GoogleFontsDialog'
import Header from './components/Header'
import { HintsContext, useShowAllHints } from './components/Hint'
import InputPanel from './components/InputPanel'
import StatusBar from './components/StatusBar'
import TextPanel from './components/TextPanel'
import TextPreview from './components/TextPreview'
import TextTools from './components/TextTools'
import ToolHead from './components/ToolHead'
import Workspace from './components/Workspace'
import type { GeometryParams, GlyphRef } from './geometry/types'
import { useLiveParams } from './sound/live'
import { mappingStore } from './sound/mappingStore'
import { applyTextCase, moveFreeText, type ArtboardParams, type TextCase } from './specimen/artboard'
import { DEFAULT_PREVIEW_LOOK, type PreviewLook } from './specimen/previewLook'
import { DEFAULT_TEXT } from './specimen/samples'
import { editorReducer, initialState, thornCanvasEm, withThornCanvasEm, type Action } from './state/editorState'
import { changedSettings, listenForUndo, undoHistory, useHistoryState } from './state/history'
import { clearRestoring, createSessionSaver, markRestoring, savedFont, type RestoredSession, type SavedGlyph, type Session } from './state/persist'
import type { AppState, EditorParams, SettingsParams, ViewParams } from './state/types'
import { useGeometry } from './state/useDerivedGeometry'
import { useFontImport } from './state/useFontImport'

/** Every parameter group but the canvas view: what undo restores and the session saves (never Thorn's derived canvasEm). */
function settingsOf({ view: _view, ...settings }: EditorParams): SettingsParams {
  const experimental = withThornCanvasEm(settings.experimental, null)
  return experimental === settings.experimental ? settings : { ...settings, experimental }
}

/** The editor's first state: the defaults, with the last visit's settings, view buttons and export precision. */
function startState(saved: Session | null): AppState {
  if (!saved) return initialState
  return {
    document: { ...initialState.document, export: { ...initialState.document.export, precision: saved.precision } },
    params: { ...saved.params, view: { ...initialState.params.view, ...saved.view } },
  }
}

interface AppProps {
  /** The last visit's session, read once before the first render (main.tsx). */
  restored: RestoredSession
}

export default function App({ restored }: AppProps) {
  const saved = restored.session
  const [state, dispatch] = useReducer(editorReducer, saved, startState)
  const importer = useFontImport(dispatch)
  const [text, setText] = useState(() => saved?.text ?? DEFAULT_TEXT)
  // The preview's blur and inversion, and its scale, so exports can reproduce the preview look.
  const [previewLook, setPreviewLook] = useState<PreviewLook>(() => saved?.previewLook ?? DEFAULT_PREVIEW_LOOK)
  const [previewScale, setPreviewScale] = useState(0)
  const { font, selectedGlyph } = state.document
  const { typography, palette, artboard } = state.params
  // The text as shown and exported: the typed text with the letter case applied.
  const displayText = useMemo(() => applyTextCase(text, typography.textCase), [text, typography.textCase])
  // While Sound drives the letters, the canvas shows live parameters; the sliders (and exports) keep their own.
  const { flatten, random, squaring, anchors, grid, distortion, experimental } = state.params
  // Thorn's Reach is a share of the canvas diagonal: the diagonal in em rides on the geometry parameters, a
  // number (null while Thorn is off), so the text size and canvas change the geometry only when it changes.
  const canvasEm = thornCanvasEm(state.params)
  const baseParams = useMemo<GeometryParams>(
    () => ({ flatten, random, squaring, anchors, grid, distortion, experimental: withThornCanvasEm(experimental, canvasEm) }),
    [flatten, random, squaring, anchors, grid, distortion, experimental, canvasEm],
  )
  // Without a font there are no letters to move: Sound does not drive.
  const liveParams = useLiveParams(baseParams, font !== null)
  const { derived, scene, layout, scenePending, loadSliderScene } = useGeometry(state, displayText, baseParams, liveParams)

  // The latest state and text, kept up to date between a change and the render that shows it: the undo
  // history reads them, and several changes in one event build on each other.
  const current = useRef({ state, text, loadSliderScene, layout })
  current.current = { state, text, loadSliderScene, layout }

  // Every settings change goes through here and is recorded for undo, one step per slider drag. The
  // canvas view, glyph selection, export settings and imports use `dispatch` and are not undone.
  const edit = useCallback((action: Action) => {
    const before = current.current.state
    const after = editorReducer(before, action)
    if (action.type === 'updateParams' && action.group !== 'view') {
      const key = changedSettings(settingsOf(before.params), settingsOf(after.params))
      if (key) undoHistory.record(key)
    }
    current.current.state = after
    dispatch(action)
  }, [])
  // Typing joins one undo step until a pause; a sample, Clear or an inserted glyph is a step of its own.
  const writeText = useCallback((next: string, typing: boolean) => {
    if (next === current.current.text) return
    undoHistory.record(typing ? 'text' : null, typing)
    current.current.text = next
    setText(next)
  }, [])
  const typeText = useCallback((next: string) => writeText(next, true), [writeText])
  const replaceText = useCallback((next: string) => writeText(next, false), [writeText])

  useEffect(
    () =>
      undoHistory.connect({
        read: () => ({ params: settingsOf(current.current.state.params), text: current.current.text, mappings: mappingStore.getState().mappings }),
        restore: ({ params, text, mappings }) => {
          const action: Action = { type: 'restoreParams', params }
          current.current.state = editorReducer(current.current.state, action)
          dispatch(action)
          current.current.text = text
          setText(text)
          mappingStore.restore(mappings)
        },
      }),
    [],
  )
  useEffect(() => listenForUndo(), [])
  const historyState = useHistoryState()
  const undo = useCallback(() => undoHistory.undo(), [])
  const redo = useCallback(() => undoHistory.redo(), [])

  const setTextCase = useCallback(
    (textCase: TextCase) => edit({ type: 'updateParams', group: 'typography', patch: { textCase } }),
    [edit],
  )
  // Free position: the canvas moves the text itself while it is dragged and reports the move (in font
  // units) once, on release; the new position is computed from where the text was, measured on the
  // sliders' own letters (as Fit text and Free are), so a live Sound frame never leaks into it. While
  // Sound drives the letters, those may first have to be computed in the geometry worker.
  const moveText = useCallback(
    (dx: number, dy: number) => {
      void current.current.loadSliderScene().then((base) => {
        const { layout, state } = current.current
        if (base && layout) edit({ type: 'updateParams', group: 'typography', patch: moveFreeText(state.params.typography, dx, dy, base, layout) })
      })
    },
    [edit],
  )
  const setArtboard = useCallback(
    (patch: Partial<ArtboardParams>) => edit({ type: 'updateParams', group: 'artboard', patch }),
    [edit],
  )

  const [googleOpen, setGoogleOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const openGoogleFonts = useCallback(() => setGoogleOpen(true), [])
  const openExport = useCallback(() => setExportOpen(true), [])

  const [showAllHints, setShowAllHints] = useShowAllHints()

  const onViewChange = useCallback(
    (patch: Partial<ViewParams>) => dispatch({ type: 'updateParams', group: 'view', patch }),
    [],
  )
  // Clicking a glyph in the canvas selects it (the statistics follow it) and highlights every copy of
  // it; the canvas view is kept. Clicking empty canvas only hides the highlight: the statistics keep
  // showing the last selected glyph.
  const [highlight, setHighlight] = useState(true)
  const selectGlyph = useCallback((glyph: GlyphRef) => {
    setHighlight(true)
    dispatch({ type: 'selectGlyph', glyph, keepView: true })
  }, [])
  const clearHighlight = useCallback(() => setHighlight(false), [])

  // The glyph list inserts characters at the text cursor (or replaces the selected text), then puts
  // the cursor after the insertion. The textarea keeps its selection while it is not focused; before
  // it has ever been focused there is no real cursor, so characters are appended.
  const textRef = useRef<HTMLTextAreaElement>(null)
  const caretRef = useRef<number | null>(null)
  const cursorPlaced = useRef(false)
  const onTextFocus = useCallback(() => {
    cursorPlaced.current = true
  }, [])
  const insertGlyph = useCallback(
    (glyph: GlyphRef, insert: string) => {
      const el = cursorPlaced.current ? textRef.current : null
      const typed = current.current.text
      const start = el ? Math.min(el.selectionStart, typed.length) : typed.length
      const end = el ? Math.min(Math.max(el.selectionEnd, start), typed.length) : typed.length
      const next = typed.slice(0, start) + insert + typed.slice(end)
      if (next !== typed) caretRef.current = start + insert.length
      replaceText(next)
      setHighlight(true)
      dispatch({ type: 'selectGlyph', glyph, keepView: true })
    },
    [replaceText],
  )
  useLayoutEffect(() => {
    const el = textRef.current
    if (el && caretRef.current !== null) {
      el.setSelectionRange(caretRef.current, caretRef.current)
      caretRef.current = null
      cursorPlaced.current = true
    }
  }, [text])

  // ---- The session saved for the next visit (state/persist.ts) ----

  // The font and glyph to reopen: the last visit's until a font loads in this one.
  const fontToSave = useMemo(() => (font ? savedFont(font) : (saved?.font ?? null)), [font, saved])
  const glyphToSave = useMemo<SavedGlyph | null>(
    () =>
      font
        ? selectedGlyph && { family: font.familyName, style: font.styleName, index: selectedGlyph.index, unicode: selectedGlyph.unicode }
        : (saved?.glyph ?? null),
    [font, selectedGlyph, saved],
  )
  const precision = state.document.export.precision
  const { outline, showFill, showSkeleton, showVertices, showMetrics } = state.params.view
  const sessionNow: Session = {
    params: settingsOf(state.params),
    view: { outline, showFill, showSkeleton, showVertices, showMetrics },
    text,
    previewLook,
    precision,
    mappings: mappingStore.getState().mappings,
    font: fontToSave,
    glyph: glyphToSave,
  }
  const session = useRef(sessionNow)
  session.current = sessionNow
  // Live Sound frames never reach these values: only the sliders' own settings are saved.
  const [saver] = useState(() => createSessionSaver(() => ({ ...session.current, mappings: mappingStore.getState().mappings })))
  useEffect(
    () => saver.schedule(),
    [saver, flatten, random, squaring, anchors, grid, distortion, experimental, typography, palette, artboard,
      outline, showFill, showSkeleton, showVertices, showMetrics, text, previewLook, precision, fontToSave, glyphToSave],
  )

  // While the restored settings are first drawn, a mark in storage says so: should the page crash on
  // them, the next visit starts from the defaults instead (loadSession).
  const restoring = useRef<'waiting' | 'drawing' | 'done'>(saved && !restored.crashed ? 'waiting' : 'done')
  useEffect(() => {
    if (restoring.current === 'waiting' && font) {
      markRestoring()
      restoring.current = 'drawing'
    }
    if (restoring.current === 'drawing' && scene && !scenePending) {
      clearRestoring()
      restoring.current = 'done'
    }
  }, [font, scene, scenePending])

  useEffect(() => {
    const unsubscribe = mappingStore.subscribe(saver.schedule)
    const onPageHide = () => {
      saver.flush()
      // Closed normally while drawing: not a crash.
      if (restoring.current === 'drawing') clearRestoring()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saver.flush()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      saver.flush()
    }
  }, [saver])

  // A Google Fonts face from the last visit is downloaded again, once. Started after StrictMode's second
  // mount: the first one's cleanup aborts any import in flight.
  const { importGoogle } = importer
  const resumeFont = saved?.font ?? null
  const resumed = useRef(false)
  useEffect(() => {
    if (resumeFont?.kind !== 'google') return
    const timer = setTimeout(() => {
      if (resumed.current || current.current.state.document.status.kind !== 'empty') return
      resumed.current = true
      const { family, weight, italic, subset } = resumeFont
      void importGoogle({ family, weight, italic, subset })
    }, 0)
    return () => clearTimeout(timer)
  }, [resumeFont, importGoogle])

  // The last visit's selected glyph, when the first font that loads is the same family and style.
  const glyphToRestore = useRef(saved?.glyph ?? null)
  useEffect(() => {
    const glyph = glyphToRestore.current
    if (!font || !glyph) return
    glyphToRestore.current = null
    if (font.familyName !== glyph.family || font.styleName !== glyph.style) return
    const ref =
      font.characters.find((c) => c.index === glyph.index && c.unicode === glyph.unicode) ??
      font.listAllGlyphs().find((g) => g.index === glyph.index)
    if (ref) dispatch({ type: 'selectGlyph', glyph: ref, keepView: true })
  }, [font])

  // What could not be restored: settings after a crash (until the first change), a local font file.
  const [crashNote, setCrashNote] = useState(restored.crashed)
  if (crashNote && historyState.canUndo) setCrashNote(false)
  const sessionNote =
    [
      crashNote ? 'The last visit closed while drawing, so its settings were not restored.' : '',
      !font && saved?.font?.kind === 'local' ? `Last font: ${saved.font.fileName}. Import it again to continue.` : '',
    ]
      .filter(Boolean)
      .join(' ') || null

  // The snap grid (lines and label) follows the letters as shown: while Sound drives Grid size, the live size.
  const shownGrid = liveParams.grid
  const gridSize = shownGrid.snap && shownGrid.size > 0 ? shownGrid.size : null

  return (
    <div className="app">
      <Header document={state.document} history={historyState} onUndo={undo} onRedo={redo} onOpenExport={openExport} />
      <HintsContext.Provider value={showAllHints}>
        <Workspace
          tools={<ToolHead document={state.document} importer={importer} onOpenGoogleFonts={openGoogleFonts} />}
          geometry={
            <GeometryPanel
              state={state}
              dispatch={edit}
              derived={derived}
              showAllHints={showAllHints}
              onShowAllHintsChange={setShowAllHints}
            />
          }
          canvas={
            <CanvasViewport
              document={state.document}
              view={state.params.view}
              scene={scene}
              layout={layout}
              palette={palette}
              artboard={artboard}
              onArtboardChange={setArtboard}
              gridSize={gridSize}
              highlightSelection={highlight}
              onSelectGlyph={selectGlyph}
              onClearHighlight={clearHighlight}
              onMoveText={typography.position === 'free' ? moveText : undefined}
              onViewChange={onViewChange}
              onResetView={() => dispatch({ type: 'resetView' })}
              onLocalFile={importer.importLocal}
              onOpenGoogleFonts={openGoogleFonts}
              note={sessionNote}
            />
          }
          textTools={
            <TextTools
              typography={typography}
              palette={palette}
              artboard={artboard}
              font={state.document.font}
              scene={scene}
              loadSliderScene={loadSliderScene}
              dispatch={edit}
              onInsertGlyph={insertGlyph}
            />
          }
          input={
            <InputPanel
              text={
                <TextPanel
                  font={state.document.font}
                  text={text}
                  scene={scene}
                  pending={scenePending}
                  onTextChange={typeText}
                  onTextReplace={replaceText}
                  inputRef={textRef}
                  onInputFocus={onTextFocus}
                  textCase={typography.textCase}
                  onTextCaseChange={setTextCase}
                />
              }
              preview={
                <TextPreview
                  font={state.document.font}
                  scene={scene}
                  layout={layout}
                  palette={palette}
                  artboard={artboard}
                  precision={precision}
                  look={previewLook}
                  onLookChange={setPreviewLook}
                  onScaleChange={setPreviewScale}
                />
              }
            />
          }
        />
      </HintsContext.Provider>
      <StatusBar state={state} glyphGeometry={derived.result} shownParams={derived.shownParams} scene={scene} />
      <GoogleFontsDialog open={googleOpen} onClose={() => setGoogleOpen(false)} onLoad={importer.importGoogle} />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        font={state.document.font}
        selectedGlyph={state.document.selectedGlyph}
        specimenText={displayText}
        typography={typography}
        palette={palette}
        artboard={artboard}
        previewLook={previewLook}
        previewScale={previewScale}
        params={derived.params}
        paramsKey={derived.paramsKey}
        // Live shapes keep changing; exports use the sliders and compute whatever they still need.
        pending={derived.pending && !derived.live}
        precision={precision}
        onPrecisionChange={(precision) => dispatch({ type: 'updateExport', patch: { precision } })}
        onExported={(fileName) =>
          dispatch({ type: 'updateExport', patch: { lastExport: { fileName, at: new Date().toISOString() } } })
        }
      />
    </div>
  )
}
