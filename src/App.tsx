import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import CanvasViewport from './components/CanvasViewport'
import ExportDialog from './components/ExportDialog'
import GeometryPanel from './components/GeometryPanel'
import Glided from './components/Glided'
import GoogleFontsDialog from './components/GoogleFontsDialog'
import Header from './components/Header'
import { HintsContext, useShowAllHints } from './components/Hint'
import InputPanel from './components/InputPanel'
import MapDragLayer from './components/MapDragLayer'
import RecordingCanvas from './components/RecordingCanvas'
import StatusBar from './components/StatusBar'
import TextPanel from './components/TextPanel'
import TextPreview from './components/TextPreview'
import TextTools from './components/TextTools'
import ToolHead, { type ConfigNotice } from './components/ToolHead'
import Workspace from './components/Workspace'
import { useRecordingContext } from './export/recorder'
import { RENDERER_CHOICE } from './render/createRenderer'
import type { LoadedFont } from './font/model'
import type { GeometryParams, GlyphRef } from './geometry/types'
import { getSoundEngine } from './sound/engine'
import { useLiveDriving, useLiveFrame, useLiveLetters } from './sound/live'
import { setTargetFont, type DrivenParams } from './sound/mapping'
import { mappingStore } from './sound/mappingStore'
import type { SoundSettings } from './sound/types'
import { applyTextCase, moveFreeText, type ArtboardParams, type TextCase } from './specimen/artboard'
import { DEFAULT_PREVIEW_LOOK, type PreviewLook } from './specimen/previewLook'
import { DEFAULT_TEXT } from './specimen/samples'
import { panZoomStore } from './state/canvasView'
import {
  editorReducer,
  initialState,
  isOtherFace,
  thornCanvasEm,
  withThornCanvasEm,
  type Action,
} from './state/editorState'
import { changedSettings, listenForUndo, undoHistory, useHistoryState, type Snapshot } from './state/history'
import {
  clearRestoring,
  createSessionSaver,
  markRestoring,
  MAX_CONFIG_BYTES,
  parseConfig,
  savedFont,
  type RestoredSession,
  type SavedFont,
  type SavedGlyph,
  type Session,
} from './state/persist'
import { DEFAULT_RESET_EXTRAS, resetHistory } from './state/reset'
import type { AppState, EditorParams, SettingsParams, ViewToggles } from './state/types'
import { useGeometry } from './state/useDerivedGeometry'
import { useFontImport } from './state/useFontImport'
import { useSceneGlide } from './state/useGlide'

/** Every parameter group but the canvas view: what undo restores and the session saves (never Thorn's derived canvasEm). */
function settingsOf({ view: _view, ...settings }: EditorParams): SettingsParams {
  const experimental = withThornCanvasEm(settings.experimental, null)
  return experimental === settings.experimental ? settings : { ...settings, experimental }
}

/** Sensitivity and Release (the engine's) with the response values (the mappings store's): undone and saved together. */
function soundSettings(): SoundSettings {
  return { ...getSoundEngine().getState().settings, ...mappingStore.getState().response }
}

/** The editor's first state: the defaults, with the last visit's settings, view buttons and export precision. */
function startState(saved: Session | null): AppState {
  if (!saved) return initialState
  return {
    document: { ...initialState.document, export: { ...initialState.document.export, precision: saved.precision } },
    params: { ...saved.params, view: { ...initialState.params.view, ...saved.view } },
  }
}

/** The saved glyph in `font`, when it is the same family and style. */
function findSavedGlyph(font: LoadedFont, glyph: SavedGlyph): GlyphRef | null {
  if (font.familyName !== glyph.family || font.styleName !== glyph.style) return null
  return (
    font.characters.find((c) => c.index === glyph.index && c.unicode === glyph.unicode) ??
    font.listAllGlyphs().find((g) => g.index === glyph.index) ??
    null
  )
}

/** Whether `font` is the one `saved` names: the same Google Fonts request, or a local file of the same name. */
function isSavedFont(font: LoadedFont, saved: SavedFont): boolean {
  const loaded = savedFont(font)
  if (loaded.kind === 'local' || saved.kind === 'local')
    return loaded.kind === 'local' && saved.kind === 'local' && loaded.fileName === saved.fileName
  return (
    loaded.family === saved.family &&
    loaded.weight === saved.weight &&
    loaded.italic === saved.italic &&
    loaded.subset === saved.subset
  )
}

/**
 * The canvas and the preview draw their glyphs with a canvas renderer (?render=canvas or webgl, render/createRenderer.ts),
 * which follows Glide's store itself; with ?render=svg they re-render with each of Glide's frames (<Glided>), as the
 * recording canvas always does.
 */
const CANVAS_GLYPHS = RENDERER_CHOICE !== 'svg'

// A take's saved file name (the recording context asks for it); nothing in the app keeps it.
const ignoreSavedTake = () => {}

interface AppProps {
  /** The last visit's session, read once before the first render (main.tsx). */
  restored: RestoredSession
}

export default function App({ restored }: AppProps) {
  const saved = restored.session
  // The last visit's session, for its font and glyph; Reset all forgets it.
  const [lastVisit, setLastVisit] = useState(saved)
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
    () => ({
      flatten,
      random,
      squaring,
      anchors,
      grid,
      distortion,
      experimental: withThornCanvasEm(experimental, canvasEm),
    }),
    [flatten, random, squaring, anchors, grid, distortion, experimental, canvasEm],
  )
  // The loaded font's variable axes are Sound targets: set in render, before the panels below read the targets in the
  // same pass (setTargetFont does nothing for the font it already has). A render React throws away can leave them on a
  // font it never showed, so every commit sets them again, before the live scheduler's layout effect reads them.
  setTargetFont(font)
  useLayoutEffect(() => setTargetFont(font))
  // Sound drives the canvas's typography and colours too: the scheduler gets them with the geometry (never in its key).
  const drivenBase = useMemo<DrivenParams>(
    () => ({ ...baseParams, typography, palette }),
    [baseParams, typography, palette],
  )
  // Without a font there are no letters to move: Sound does not drive.
  const live = useLiveFrame(drivenBase, font !== null)
  const { derived, scene, layout, placement, scenePending, loadSliderScene, letterSlots, shownFont } = useGeometry(
    state,
    displayText,
    baseParams,
    live,
  )
  // The colours as shown and recorded: Sound's over the sliders'. Exports keep the sliders' own.
  const livePalette = live.look?.palette
  const shownPalette = useMemo(() => (livePalette ? { ...palette, ...livePalette } : palette), [palette, livePalette])
  // While Sound drives an axis, the canvas reads the outlines it draws over (Original, Compare) from the live instance.
  const canvasDocument = useMemo(
    () => (shownFont === state.document.font ? state.document : { ...state.document, font: shownFont }),
    [shownFont, state.document],
  )
  // After useGeometry, so a new text's first live frame asks for the glyphs the canvas now shows.
  useLiveLetters(letterSlots)
  // Glide: while Sound moves the letters, the canvas, the preview and the video glide into each new shape (useGlide.ts).
  const driving = useLiveDriving()
  const glide = useSceneGlide(scene, driving, `${font?.id ?? ''}\n${displayText}`, live.timing)

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

  // Puts back what one undo step holds (undo and redo, a config file); records nothing itself.
  const applySnapshot = useCallback(({ params, text, mappings, sound }: Snapshot) => {
    const action: Action = { type: 'restoreParams', params }
    current.current.state = editorReducer(current.current.state, action)
    dispatch(action)
    current.current.text = text
    setText(text)
    mappingStore.restore(mappings)
    if (sound) {
      getSoundEngine().setSettings({ sensitivity: sound.sensitivity, releaseMs: sound.releaseMs })
      mappingStore.restoreResponse(sound)
    }
  }, [])
  useEffect(
    () =>
      undoHistory.connect({
        read: () => ({
          params: settingsOf(current.current.state.params),
          text: current.current.text,
          mappings: mappingStore.getState().mappings,
          sound: soundSettings(),
        }),
        restore: applySnapshot,
      }),
    [applySnapshot],
  )
  useEffect(() => listenForUndo(), [])
  const historyState = useHistoryState()

  const setTextCase = useCallback(
    (textCase: TextCase) => edit({ type: 'updateParams', group: 'typography', patch: { textCase } }),
    [edit],
  )
  // Free position: the canvas moves the text itself while it is dragged and reports the move (in font
  // units) once, on release; the new position is computed from where the text was, measured on the
  // sliders' own letters (as Fit text and Free are), so a live Sound frame never leaks into it. While
  // Sound drives the letters, those may first have to be computed in the geometry worker. It resolves false when
  // nothing moved, so the canvas drops its drag offset instead of waiting for a new layout.
  const moveText = useCallback(
    (dx: number, dy: number) =>
      current.current.loadSliderScene().then(
        (base) => {
          const { layout, state } = current.current
          if (!base || !layout) return false
          const typography = state.params.typography
          const patch = moveFreeText(typography, dx, dy, base, layout)
          if (patch.freeX === typography.freeX && patch.freeY === typography.freeY) return false
          edit({ type: 'updateParams', group: 'typography', patch })
          return true
        },
        () => false,
      ),
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
    (patch: Partial<ViewToggles>) => dispatch({ type: 'updateParams', group: 'view', patch }),
    [],
  )
  // A new font opens fitted; another face of the open collection keeps the zoom and pan, as it keeps the character.
  const lastFont = useRef(font)
  useLayoutEffect(() => {
    if (font === lastFont.current) return
    if (font && !isOtherFace(lastFont.current, font)) panZoomStore.reset()
    lastFont.current = font
  }, [font])
  // Clicking a glyph in the canvas selects it (the statistics follow it) and highlights every copy of
  // it; the canvas view is kept. Clicking empty canvas only hides the highlight: the statistics keep
  // showing the last selected glyph.
  const [highlight, setHighlight] = useState(true)
  const selectGlyph = useCallback((glyph: GlyphRef) => {
    setHighlight(true)
    dispatch({ type: 'selectGlyph', glyph })
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
      dispatch({ type: 'selectGlyph', glyph })
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
  const fontToSave = useMemo(() => (font ? savedFont(font) : (lastVisit?.font ?? null)), [font, lastVisit])
  const glyphToSave = useMemo<SavedGlyph | null>(
    () =>
      font
        ? selectedGlyph && {
            family: font.familyName,
            style: font.styleName,
            index: selectedGlyph.index,
            unicode: selectedGlyph.unicode,
          }
        : (lastVisit?.glyph ?? null),
    [font, selectedGlyph, lastVisit],
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
    sound: soundSettings(),
    font: fontToSave,
    glyph: glyphToSave,
  }
  const session = useRef(sessionNow)
  session.current = sessionNow
  // Live Sound frames never reach these values: only the sliders' own settings are saved. The mappings and
  // the Sound settings change outside React, so they are read when the save happens (or a config is exported).
  const readSessionNow = useCallback(
    (): Session => ({ ...session.current, mappings: mappingStore.getState().mappings, sound: soundSettings() }),
    [],
  )
  // Storage full or blocked: the status bar says that the settings will not be kept, until a save works again.
  const [saveFailed, setSaveFailed] = useState(false)
  const [saver] = useState(() =>
    createSessionSaver(readSessionNow, undefined, undefined, (saved) => setSaveFailed(!saved)),
  )
  useEffect(
    () => saver.schedule(),
    [
      saver,
      flatten,
      random,
      squaring,
      anchors,
      grid,
      distortion,
      experimental,
      typography,
      palette,
      artboard,
      outline,
      showFill,
      showSkeleton,
      showVertices,
      showMetrics,
      text,
      previewLook,
      precision,
      fontToSave,
      glyphToSave,
    ],
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
    const engine = getSoundEngine()
    // The engine's state changes several times a second while a file plays; only Sensitivity and Release are saved.
    let settings = engine.getState().settings
    const unsubscribeSettings = engine.subscribeState(() => {
      const next = engine.getState().settings
      if (next.sensitivity === settings.sensitivity && next.releaseMs === settings.releaseMs) return
      settings = next
      saver.schedule()
    })
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
      unsubscribeSettings()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      saver.flush()
    }
  }, [saver])

  // A Google Fonts face from the last visit is downloaded again, once. Started after StrictMode's second
  // mount: the first one's cleanup aborts any import in flight.
  const { importGoogle } = importer
  const resumeFont = lastVisit?.font ?? null
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
    const ref = findSavedGlyph(font, glyph)
    if (ref) dispatch({ type: 'selectGlyph', glyph: ref })
  }, [font])

  // ---- Config files (Export → Config, Import → Config file) ----

  const [configNotice, setConfigNotice] = useState<ConfigNotice | null>(null)
  const dismissConfigNotice = useCallback(() => setConfigNotice(null), [])
  // The settings, text, Sound mappings and Response are applied as one undo step; the canvas view's buttons,
  // the preview look and the export precision are never undone, here as anywhere. The font follows the
  // config: a Google Fonts face is downloaded (unless it is open), a local file can only be named.
  const importConfig = useCallback(
    async (file: File) => {
      if (file.size > MAX_CONFIG_BYTES) {
        setConfigNotice({ tone: 'error', text: `${file.name} is larger than 1 MB, too large for a config file.` })
        return
      }
      let text: string
      try {
        text = await file.text()
      } catch {
        setConfigNotice({ tone: 'error', text: `${file.name} could not be read as a config file.` })
        return
      }
      const parsed = parseConfig(text)
      if (!parsed.ok) {
        setConfigNotice({ tone: 'error', text: parsed.error })
        return
      }
      const config = parsed.session
      undoHistory.transaction(() => {
        undoHistory.record(null)
        applySnapshot(config)
      })
      for (const action of [
        { type: 'updateParams', group: 'view', patch: config.view },
        { type: 'updateExport', patch: { precision: config.precision } },
      ] satisfies Action[]) {
        current.current.state = editorReducer(current.current.state, action)
        dispatch(action)
      }
      setPreviewLook(config.previewLook)

      const notes = [`Imported ${file.name}. Undo reverts its settings, text and Sound.`]
      if (parsed.newer)
        notes.push('It was saved by a newer None-Curve: settings this version does not know were left out.')
      const open = current.current.state.document.font
      const wanted = config.font
      if (!wanted || (open && isSavedFont(open, wanted))) {
        // The font stays: the config's glyph is selected in it when it is the same family and style.
        const ref = open && config.glyph ? findSavedGlyph(open, config.glyph) : null
        if (ref) dispatch({ type: 'selectGlyph', glyph: ref })
      } else {
        glyphToRestore.current = config.glyph
        if (wanted.kind === 'google') {
          const { family, weight, italic, subset } = wanted
          void importGoogle({ family, weight, italic, subset })
        } else {
          notes.push(`Its font is the local file ${wanted.fileName}: import it to see the config as it was saved.`)
        }
      }
      setConfigNotice({ tone: 'info', text: notes.join(' ') })
    },
    [applySnapshot, importGoogle],
  )
  // A font chosen by hand replaces whatever the last config asked for. A .json file (dropped on the canvas,
  // say) is read as a config.
  const { importLocal } = importer
  const importLocalFont = useCallback(
    (file: File) => {
      if (/\.json$/i.test(file.name)) return importConfig(file)
      setConfigNotice(null)
      return importLocal(file)
    },
    [importLocal, importConfig],
  )
  const importGoogleFont = useCallback(
    (request: Parameters<typeof importGoogle>[0]) => {
      setConfigNotice(null)
      return importGoogle(request)
    },
    [importGoogle],
  )

  // What could not be restored: settings after a crash (until the first change), a local font file.
  const [crashNote, setCrashNote] = useState(restored.crashed)
  if (crashNote && historyState.canUndo) setCrashNote(false)
  const sessionNote =
    [
      crashNote ? 'The last visit closed while drawing, so its settings were not restored.' : '',
      !font && lastVisit?.font?.kind === 'local'
        ? `Last font: ${lastVisit.font.fileName}. Import it again to continue.`
        : '',
    ]
      .filter(Boolean)
      .join(' ') || null

  // ---- Reset all (state/reset.ts): back to how the editor first opens; the history is cleared ----

  const { cancel: cancelImport } = importer
  const resetAll = useCallback(() => {
    // The settings, text, mappings and Response, through the history, which forgets every step.
    if (!resetHistory()) return
    cancelImport()
    current.current.state = initialState
    dispatch({ type: 'resetAll' })
    panZoomStore.reset()
    setPreviewLook(DEFAULT_RESET_EXTRAS.previewLook)
    // The last visit's font is neither reopened nor saved again.
    setLastVisit(null)
    resumed.current = true
    glyphToRestore.current = null
    if (restoring.current !== 'done') {
      clearRestoring()
      restoring.current = 'done'
    }
    setConfigNotice(null)
    setCrashNote(false)
    mappingStore.setDrive(!mappingStore.getState().reducedMotion)
    const engine = getSoundEngine()
    if (engine.getState().playing) engine.pause()
    if (engine.getState().listening) engine.stopMicrophone()
  }, [cancelImport])

  // A video records the canvas as shown (recorder.ts): the font names the file, the artboard sets its size.
  useRecordingContext(
    font
      ? {
          family: font.familyName,
          style: font.styleName,
          artboard,
          transparent: palette.transparent,
          onSaved: ignoreSavedTake,
        }
      : null,
  )

  // The snap grid (lines and label) follows the letters as shown: while Sound drives Grid size, the live size.
  const shownGrid = live.params.grid
  const gridSize = shownGrid.snap && shownGrid.size > 0 ? shownGrid.size : null

  // The canvas and the preview, but for the scene they draw (as shown, or the target with Glide's store). Memoized,
  // so a render of App that changes neither leaves them alone.
  const { view } = state.params
  const freeMove = typography.position === 'free' ? moveText : undefined
  const canvasProps = useMemo(
    () => ({
      document: canvasDocument,
      view,
      layout,
      placement,
      palette: shownPalette,
      ownPalette: palette,
      artboard,
      onArtboardChange: setArtboard,
      gridSize,
      highlightSelection: highlight,
      onSelectGlyph: selectGlyph,
      onClearHighlight: clearHighlight,
      onMoveText: freeMove,
      onViewChange,
      onLocalFile: importLocalFont,
      onOpenGoogleFonts: openGoogleFonts,
      note: sessionNote,
    }),
    [
      canvasDocument,
      view,
      layout,
      placement,
      shownPalette,
      palette,
      artboard,
      setArtboard,
      gridSize,
      highlight,
      selectGlyph,
      clearHighlight,
      freeMove,
      onViewChange,
      importLocalFont,
      openGoogleFonts,
      sessionNote,
    ],
  )
  const previewProps = useMemo(
    () => ({
      font: state.document.font,
      layout,
      palette: shownPalette,
      artboard,
      precision,
      look: previewLook,
      fill: view.showFill,
      live: driving,
      onLookChange: setPreviewLook,
      onScaleChange: setPreviewScale,
    }),
    [state.document.font, layout, shownPalette, artboard, precision, previewLook, view.showFill, driving],
  )
  const closeGoogleFonts = useCallback(() => setGoogleOpen(false), [])
  const closeExport = useCallback(() => setExportOpen(false), [])
  const setPrecision = useCallback((precision: number) => dispatch({ type: 'updateExport', patch: { precision } }), [])

  return (
    <div className="app">
      <Header document={state.document} onOpenExport={openExport} />
      <HintsContext.Provider value={showAllHints}>
        <Workspace
          tools={
            <ToolHead
              document={state.document}
              importer={{ ...importer, importLocal: importLocalFont }}
              onOpenGoogleFonts={openGoogleFonts}
              onConfigFile={importConfig}
              configNotice={configNotice}
              onDismissConfigNotice={dismissConfigNotice}
            />
          }
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
            // A canvas renderer takes Glide's frames from the store; the SVG renderer re-renders with each one.
            CANVAS_GLYPHS ? (
              <CanvasViewport {...canvasProps} scene={scene} glide={glide} />
            ) : (
              <Glided store={glide} scene={scene}>
                {(shown) => <CanvasViewport {...canvasProps} scene={shown} />}
              </Glided>
            )
          }
          textTools={
            <TextTools
              typography={typography}
              palette={palette}
              livePalette={livePalette}
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
                CANVAS_GLYPHS ? (
                  <TextPreview {...previewProps} scene={scene} glide={glide} />
                ) : (
                  <Glided store={glide} scene={scene}>
                    {(shown) => <TextPreview {...previewProps} scene={shown} />}
                  </Glided>
                )
              }
            />
          }
        />
      </HintsContext.Provider>
      <StatusBar
        state={state}
        glyphGeometry={derived.result}
        shownParams={derived.shownParams}
        scene={scene}
        text={text}
        extras={{ previewLook, precision }}
        onReset={resetAll}
        saveFailed={saveFailed}
      />
      {/* Drag to map: the dragged feature's chip and what a drop did. */}
      <MapDragLayer />
      <GoogleFontsDialog open={googleOpen} onClose={closeGoogleFonts} onLoad={importGoogleFont} />
      <ExportDialog
        open={exportOpen}
        onClose={closeExport}
        font={state.document.font}
        selectedGlyph={state.document.selectedGlyph}
        specimenText={displayText}
        typography={typography}
        palette={palette}
        artboard={artboard}
        previewLook={previewLook}
        previewScale={previewScale}
        fill={view.showFill}
        params={derived.params}
        paramsKey={derived.paramsKey}
        // Live shapes keep changing; exports use the sliders and compute whatever they still need.
        pending={derived.pending && !derived.live}
        precision={precision}
        onPrecisionChange={setPrecision}
        readConfig={readSessionNow}
      />
      {/* Renders only during a take: the canvas the video is captured from, drawn with the shapes as shown. */}
      <Glided store={glide} scene={scene}>
        {(shown) => (
          <RecordingCanvas
            scene={shown}
            layout={layout}
            artboard={artboard}
            palette={shownPalette}
            previewLook={previewLook}
            previewScale={previewScale}
            fill={view.showFill}
          />
        )}
      </Glided>
    </div>
  )
}
