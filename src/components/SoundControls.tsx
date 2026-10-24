import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { getRecorder } from '../export/recorder'
import type { VariationAxis } from '../font/model'
import type { SoundEngine } from '../sound/engine'
import { FLASH_LIMITS } from '../sound/flash'
import { JUMP_LIMITS } from '../sound/jumps'
import { freezeLive, useLiveStatus } from '../sound/live'
import {
  DEFAULT_SHAPING,
  FEATURE_GROUPS,
  FEATURES,
  MAPPING_MODES,
  SHAPING_LIMITS,
  TARGETS,
  applyPatches,
  axisTargets,
  featureById,
  featureValue,
  shapingOf,
  sharedRange,
  targetById,
  whileSwitchesFire,
  type Activation,
  type DrivenParams,
  type FeatureGroup,
  type FeatureId,
  type FeatureSpec,
  type Mapping,
  type MappingMode,
  type TargetSpec,
} from '../sound/mapping'
import { MAPPING_LIMITS, mappingStore, useMappingState } from '../sound/mappingStore'
import { PRESETS, presetSettings, type Preset } from '../sound/presets'
import {
  DEFAULT_FEATURE_SETTINGS,
  DEFAULT_RESPONSE,
  RESPONSE_LIMITS,
  SILENT_FRAME,
  SOUND_LIMITS,
  type FeatureFrame,
  type FeatureSettings,
  type ResponseSettings,
  type SoundError,
  type SoundErrorKind,
  type SoundSource,
  type SoundState,
} from '../sound/types'
import { useSoundEngine, useSoundFrames, useSoundState } from '../sound/useSound'
import type { Action } from '../state/editorState'
import { UNDO_KEYS, undoHistory, useHistoryState } from '../state/history'
import type { EditorParams } from '../state/types'
import BufferedBar from './BufferedBar'
import { HintButton, HintText, useHint, type HintState } from './Hint'
import Icon from './Icon'
import Knob from './Knob'
import {
  cancelMapDrag,
  clearMark,
  pressMeter,
  setDropHandler,
  startPick,
  TARGET_GROUPS,
  targetName,
  useMarked,
  type DropOutcome,
} from './mapDrag'
import RangeControl from './RangeControl'
import { RecordGroup } from './RecordControls'

const sources: [SoundSource, string][] = [
  ['file', 'File'],
  ['microphone', 'Microphone'],
]

const errorText: Record<SoundErrorKind, string> = {
  unsupported: 'This browser cannot analyse sound.',
  decode: 'This file is not audio this browser can play.',
  empty: 'This file has no length.',
  'too-large': `This file is too large (over ${Math.round(SOUND_LIMITS.maxFileBytes / 1024 ** 2)} MB).`,
  permission: 'Microphone access was refused. Allow it in the browser’s site settings, then try again.',
  'no-device': 'No microphone found.',
  'device-busy': 'The microphone could not be opened; another app may be using it.',
  insecure: 'The microphone needs a secure page (https or localhost).',
  'mic-connect': 'The microphone opened, but this browser could not analyse it.',
  'mic-ended': 'The microphone stopped.',
}

/** The message for an error. "Unsupported" depends on what was being opened: Web Audio or the microphone. */
const errorMessage = (error: SoundError, microphone: boolean) =>
  error.kind === 'unsupported' && microphone ? 'This browser cannot use the microphone.' : errorText[error.kind]

/** Meter numbers change at most this often (ms), so they stay readable; the meters move every frame. */
const TEXT_INTERVAL_MS = 100
/** Screen readers get new meter values at most this often (ms). */
const ARIA_INTERVAL_MS = 250
/** Pan reads "C" (centred) while it leans less than this far to either side. */
const PAN_CENTRE = 0.05
/** A value to a thousandth: Pitch reads "—" once its meter would show nothing at all. */
const barScale = (value: number) => Math.round(value * 1000) / 1000
/** Segments in each meter; Pan lights half of them to either side of its centre. */
const LED_SEGMENTS = 12
/**
 * A reading as the share of a meter that is lit, in whole segments (Pan: whole segments from the centre), so a
 * meter that holds still costs no style change.
 */
const ledShare = (value: number, bipolar = false) => {
  const segments = bipolar ? LED_SEGMENTS / 2 : LED_SEGMENTS
  return Math.round(value * segments) / segments
}

/** "−18 dB" with a real minus sign; `signed` also puts "+" before positive values. */
function formatDb(db: number, signed = false): string {
  const n = Math.round(db)
  return `${n < 0 ? '−' : n > 0 && signed ? '+' : ''}${Math.abs(n)} dB`
}

/** A whole percentage with a real minus sign ("−40%"); `signed` also puts "+" before positive values. */
function formatPercent(value: number, signed = false): string {
  const n = Math.round(value)
  return `${n < 0 ? '−' : n > 0 && signed ? '+' : ''}${Math.abs(n)}%`
}

/** Seconds as "m:ss". */
function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Runs an engine action from an event handler. The engine reports failures in its state; anything thrown is a bug, so it is logged. */
function run(action: Promise<void>): void {
  action.catch((err: unknown) => console.error(err))
}

/** Applies an activation's (or a preset's) changes to the sliders, as Freeze does: one undo step. */
function applyActivation({ patches }: Pick<Activation, 'patches'>, dispatch: Dispatch<Action>): void {
  undoHistory.transaction(() => {
    // `group` and `patch` always match; TypeScript cannot pair a union key with its value here.
    for (const { group, patch } of patches) dispatch({ type: 'updateParams', group, patch } as Action)
  })
}

interface SoundControlsProps {
  /** The slider values: they decide which mapping targets currently act (their step or effect is on). The artboard and palette set a video's size and background. */
  params: EditorParams
  /** For Freeze, which copies the live values into the sliders. */
  dispatch: Dispatch<Action>
  /** The loaded font's variable axes, which are targets too (axisTargets); a new font re-renders the target lists. */
  axes?: readonly VariationAxis[]
}

/**
 * The Sound tab, laid out like a synth plugin: the transport (a source — a local audio file or the
 * microphone — Drive letters, presets, Freeze and the frame rate), Input (Sensitivity and Release beside a
 * meter for each thing the analyser measures), Response (how the letters answer), Modulation (the mappings
 * that let the measurements move the Geometry and Experimental sliders live, see docs/SOUND_PLAN.md) and
 * Record. Nothing depends on a font, so no control is disabled without one.
 */
function SoundControls({ params, dispatch, axes }: SoundControlsProps) {
  const engine = useSoundEngine()
  const state = useSoundState()
  const introHint = useHint()
  // What the last preset Load did, under the Preset row until the next Load or until another preset is chosen.
  const [presetNotice, setPresetNotice] = useState<string | null>(null)
  // What picking a target switched on, by mapping id, shown under its row until the row's target changes again.
  const [notices, setNotices] = useState<ReadonlyMap<string, string>>(new Map())
  // Undo and redo put back settings and mappings these notices no longer describe.
  const { restores } = useHistoryState()
  const [noticesFor, setNoticesFor] = useState(restores)
  if (noticesFor !== restores) {
    setNoticesFor(restores)
    setPresetNotice(null)
    setNotices(new Map())
  }

  const setNotice = (id: string, notice: string | null) =>
    setNotices((current) => {
      if ((current.get(id) ?? null) === notice) return current
      const next = new Map(current)
      if (notice === null) next.delete(id)
      else next.set(id, notice)
      return next
    })

  /**
   * Switches on what `target` needs to act (its step, effect or mode) and says so under the row; with
   * nothing to switch, clears the row's notice. Leaving a target never switches anything off again.
   */
  const activate = (id: string, target: TargetSpec | undefined): Activation | null => {
    const activation = target?.activate(params) ?? null
    if (activation) applyActivation(activation, dispatch)
    setNotice(id, activation?.notice ?? null)
    return activation
  }

  /**
   * Drag to map (mapDrag.ts): a feature dropped on a control becomes a row at +50% (in Toggle on a switch), and what
   * the control needs is switched on as Add mapping does: one undo step. The same mapping twice is not added; the
   * row there is marked instead, and switched on (with what its target needs) when it was off, so the drop always
   * leaves the control moving. What happened comes back for the confirmation beside the control.
   */
  const drop = (feature: FeatureId, targetId: string): DropOutcome => {
    const target = targetById(targetId)
    const pair = `${featureById(feature)?.label ?? feature} → ${target ? targetName(target) : targetId}`
    const result = undoHistory.transaction(() => {
      const connected = mappingStore.connect(feature, targetId, DEFAULT_DEPTH)
      // A found row keeps its notice unless something has to be switched on again (its effect was turned off since).
      const needs = connected && (connected.created || target?.activate(params) != null)
      return connected && { ...connected, activation: needs ? activate(connected.id, target) : null }
    })
    if (!result) {
      return { message: `Up to ${MAPPING_LIMITS.maxMappings} mappings: remove one to map ${pair}.`, mappingId: null, created: false }
    }
    // What the row says while the control still does nothing (a grey has no hue, and nothing can switch that on).
    const after = result.activation ? applyPatches(params, result.activation.patches) : params
    const still = target?.inactive(after) ?? null
    let first: string
    if (result.created) {
      const amount =
        target?.kind === 'switch' ? 'in Toggle' : target?.kind === 'jump' ? `at Rate ${DEFAULT_DEPTH * 100}%` : `at Depth +${DEFAULT_DEPTH * 100}%`
      first = `Mapped ${pair} ${amount}.`
    } else {
      const n = mappingStore.getState().mappings.findIndex((m) => m.id === result.id) + 1
      first = result.switchedOn ? `${pair} was mapped already (mapping ${n}, off): switched it on.` : `${pair} is mapped already (mapping ${n}).`
    }
    const message = [first, result.activation?.notice, still].filter(Boolean).join(' ')
    return { message, mappingId: result.id, created: result.created }
  }
  // Drops are handled with this render's settings; the tab stays mounted once opened, so drops reach it from any tab.
  const dropRef = useRef(drop)
  useLayoutEffect(() => {
    dropRef.current = drop
  })
  useEffect(() => {
    const unset = setDropHandler((feature, target) => dropRef.current(feature, target))
    return () => {
      unset()
      // A drag or keyboard pick under way would otherwise keep its listeners (and the outlines) with no tab to drop on.
      cancelMapDrag()
    }
  }, [])

  /**
   * Resets the Geometry and Experimental settings to their defaults (seeds kept), sets the preset's start
   * values and replaces the mappings with its own (presetSettings). The rows should then need nothing;
   * should one, what it needs is switched on as when a target is picked by hand, row by row against the
   * settings the rows before it left (so a switch is turned on, and named, once). One undo step puts back
   * the settings and the mappings from before.
   */
  const loadPreset = (preset: Preset) =>
    undoHistory.transaction(() => {
      const loaded = presetSettings(params, preset)
      applyActivation(loaded, dispatch)
      setPresetNotice(loaded.notice)
      mappingStore.replace(preset.mappings)
      let current = loaded.params
      const next = new Map<string, string>()
      for (const mapping of mappingStore.getState().mappings) {
        const activation = targetById(mapping.target)?.activate(current) ?? null
        if (!activation) continue
        applyActivation(activation, dispatch)
        current = applyPatches(current, activation.patches)
        next.set(mapping.id, activation.notice)
      }
      setNotices(next)
    })

  return (
    <>
      <div className="panel-notice panel-intro">
        <p className="field-title">
          <span>Listens to an audio file or the microphone and moves the letters with it.</span>
          <HintButton hint={introHint} topic="the Sound tab" />
        </p>
        <HintText hint={introHint}>
          Audio stays in your browser: files are read locally and never uploaded, and the microphone is only used while you
          listen.
        </HintText>
      </div>

      <TransportGroup
        engine={engine}
        state={state}
        dispatch={dispatch}
        presetNotice={presetNotice}
        onPresetChosen={() => setPresetNotice(null)}
        onLoadPreset={loadPreset}
      />
      <InputGroup engine={engine} settings={state.settings} />
      <ResponseGroup engine={engine} settings={state.settings} />
      <ModulationGroup params={params} axes={axes} notices={notices} onActivate={activate} onRemove={(id) => setNotice(id, null)} />
      <RecordGroup artboard={params.artboard} transparent={params.palette.transparent} collapsible />
    </>
  )
}

// Its props (all the parameters and dispatch) stay the same while Sound drives the letters.
export default memo(SoundControls)

/** A boxed section of the tab, as on a synth plugin's panel. */
function SoundBox({ legend, className, children }: { legend: string; className?: string; children: ReactNode }) {
  return (
    <fieldset className={className ? `group sound sound-box ${className}` : 'group sound sound-box'}>
      <legend>{legend}</legend>
      {/* One fixed child: Chrome ends a drag when the fieldset's own children change. */}
      <div className="group-body">{children}</div>
    </fieldset>
  )
}

/**
 * Return to plain, a large switch in its own panel, and its Hold knob: the letters rest on their plain shapes (every
 * Experimental effect off) and each beat shows the effects switched on in the Experimental tab for Hold.
 */
function PlainField({ response, hint }: { response: ResponseSettings; hint: HintState }) {
  const on = response.plain === 1
  const { min, max, step } = RESPONSE_LIMITS.holdMs
  return (
    <div className={on ? 'field sound-plain sound-plain-on' : 'field sound-plain'}>
      <div className="sound-row">
        <div className="field-toggle">
          <span className="switch switch-large">
            <input
              id="sound-plain"
              type="checkbox"
              role="switch"
              checked={on}
              aria-describedby={hint.id}
              onChange={(e) => mappingStore.setResponse({ plain: e.target.checked ? 1 : 0 })}
            />
            <span className="switch-track" aria-hidden="true" />
          </span>
          <span className="field-title">
            <label htmlFor="sound-plain">Return to plain</label>
            <HintButton hint={hint} topic="Return to plain" />
          </span>
        </div>
        <Knob
          label="Hold"
          name="Return to plain hold"
          size="small"
          value={response.holdMs}
          min={min}
          max={max}
          step={step}
          defaultValue={DEFAULT_RESPONSE.holdMs}
          format={(v) => `${v} ms`}
          valueText={`${response.holdMs} milliseconds`}
          unit="ms"
          describedBy={hint.id}
          onChange={(next) => mappingStore.setResponse({ holdMs: next })}
        />
      </div>
      <HintText hint={hint}>
        The letters rest on their plain shapes, every Experimental effect off, and each beat brings back the effects you
        switched on in the Experimental tab, then they return. Hold sets how long each beat shows them. Your mappings still
        act on top. Glide smooths the way there and back.
      </HintText>
    </div>
  )
}

interface TransportGroupProps {
  engine: SoundEngine
  state: SoundState
  dispatch: Dispatch<Action>
  presetNotice: string | null
  /** Another preset was chosen in the list (it is not loaded yet). */
  onPresetChosen: () => void
  onLoadPreset: (preset: Preset) => void
}

/**
 * The transport: the source and its controls (play, the file and its time, or the microphone), Drive letters,
 * the presets, Freeze and the live frame rate.
 */
function TransportGroup({ engine, state, dispatch, presetNotice, onPresetChosen, onLoadPreset }: TransportGroupProps) {
  const { response, drive, reducedMotion } = useMappingState()
  const status = useLiveStatus()
  const micHint = useHint()
  const driveHint = useHint()
  const plainHint = useHint()
  const freezeHint = useHint()
  const presetHint = useHint()
  const reducedId = useId()
  const stillId = useId()
  const recordingId = useId()
  const presetSelectId = useId()
  const bufferId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [presetId, setPresetId] = useState(PRESETS[0]?.id ?? '')
  // What the user last asked for, to word an "unsupported" error.
  const [askedMicrophone, setAskedMicrophone] = useState(false)
  const loaded = state.fileName !== null && state.duration > 0
  const position = Math.min(state.position, state.duration)
  const running = state.playing || state.listening
  // What the Position slider says to screen readers. Held while playing, so a focused slider is not read
  // out every second; it follows the user's own seeks and catches up on pause or end.
  const [spokenPosition, setSpokenPosition] = useState(position)
  if (!state.playing && !Object.is(spokenPosition, position)) setSpokenPosition(position)
  // Start listening waits while a permission request is pending; Stop listening always works.
  const micBlocked = state.busy && !state.listening
  const noSound = state.noSound && running
  const reducedNote = reducedMotion && !drive
  const stillNote = response.strength === 0
  const perLetter = response.contrast > 0 || response.pitchReactive > 0
  // Freeze would pause the sound and end a take, so it is off while one runs (re-renders only when that changes, not with the elapsed time).
  const recorder = getRecorder()
  const recording = useSyncExternalStore(recorder.subscribe, () => recorder.getState().phase !== 'idle')

  const chooseSource = (source: SoundSource) => {
    setAskedMicrophone(source === 'microphone')
    // Choosing a source never opens the microphone; only Start listening does.
    run(engine.setSource(source))
  }

  return (
    <SoundBox legend="Transport" className="sound-transport">
      <div className="field">
        <div className="sound-row sound-row-wrap">
          <div className="segmented segmented-small" role="radiogroup" aria-label="Source">
            {sources.map(([source, label]) => (
              <label key={source} className="segment-option">
                <input
                  type="radio"
                  name="sound-source"
                  value={source}
                  checked={state.source === source}
                  onChange={() => chooseSource(source)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="field-toggle sound-drive">
            {/* A checkbox announced and drawn as an on/off switch: the track and knob are its sibling. */}
            <span className="switch">
              <input
                id="sound-drive"
                type="checkbox"
                role="switch"
                checked={drive}
                aria-describedby={[reducedNote && reducedId, stillNote && stillId, driveHint.id].filter(Boolean).join(' ')}
                onChange={(e) => mappingStore.setDrive(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
            </span>
            <span className="field-title">
              <label htmlFor="sound-drive">Drive letters</label>
              <HintButton hint={driveHint} topic="Drive letters" />
            </span>
          </div>
        </div>
        {reducedNote && (
          <p id={reducedId} className="field-hint">
            Off because your system asks for reduced motion.
          </p>
        )}
        {stillNote && (
          <p id={stillId} className="field-hint">
            Strength is 0%: the letters hold still.
          </p>
        )}
        <HintText hint={driveHint}>
          Sound moves the letters only while this is on and a file plays or the microphone listens. The sliders keep their
          own values; a marker on each driven slider shows the live value.
        </HintText>
      </div>

      <PlainField response={response} hint={plainHint} />

      {state.source === 'file' && (
        <div className="field">
          <div className="sound-row">
            <button
              type="button"
              className="button-small button-icon"
              disabled={!loaded || state.busy}
              aria-label={state.playing ? 'Pause' : 'Play'}
              title={state.playing ? 'Pause' : 'Play'}
              onClick={() => (state.playing ? engine.pause() : run(engine.play()))}
            >
              <Icon name={state.playing ? 'pause' : 'play'} />
            </button>
            {/* aria-disabled, not disabled: the button keeps keyboard focus while the file it opened loads. Its
                caption shows only until a file is chosen; then the file name stands beside the icon. */}
            <button
              type="button"
              className={state.fileName === null ? 'button-small' : 'button-small button-icon'}
              aria-disabled={state.busy || undefined}
              aria-label={state.fileName === null ? undefined : 'Choose file'}
              title="Choose file"
              onClick={() => {
                if (state.busy) return
                setAskedMicrophone(false)
                fileInput.current?.click()
              }}
            >
              <Icon name="upload" />
              {state.fileName === null && 'Choose file'}
            </button>
            {state.fileName !== null && (
              <span className="sound-file" title={state.fileName}>
                <span className="sound-file-name">{state.fileName}</span>
              </span>
            )}
            {loaded && (
              // Not a live region: it changes every second while playing. The Position slider gives the same time (held while playing).
              <output className="sound-time" htmlFor="sound-position" aria-live="off">
                {formatTime(position)} / {formatTime(state.duration)}
              </output>
            )}
            <div className="field-toggle sound-loop">
              <input id="sound-loop" type="checkbox" checked={state.loop} onChange={(e) => engine.setLoop(e.target.checked)} />
              <label htmlFor="sound-loop">Loop</label>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              hidden
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0]
                // Reset so choosing the same file again still triggers a change.
                e.target.value = ''
                if (file) run(engine.loadFile(file))
              }}
            />
          </div>
          {/* The buffered bar under the track: what precomputed playback has prepared (BufferedBar.tsx). */}
          <span className="sound-position-slider">
            <input
              id="sound-position"
              className="sound-position"
              type="range"
              aria-label="Position"
              aria-describedby={loaded ? bufferId : undefined}
              min={0}
              max={loaded ? state.duration : 0}
              step={1}
              value={loaded ? position : 0}
              disabled={!loaded}
              aria-valuetext={`${formatTime(spokenPosition)} of ${formatTime(state.duration)}`}
              onChange={(e) => {
                const time = Number(e.target.value)
                setSpokenPosition(time)
                engine.seek(time)
              }}
            />
            {loaded && <BufferedBar id={bufferId} position={spokenPosition} format={formatTime} />}
          </span>
        </div>
      )}

      {state.source === 'microphone' && (
        <div className="field">
          <div className="sound-row">
            {/* aria-disabled, not disabled: the button keeps keyboard focus while the browser asks for permission. */}
            <button
              type="button"
              className="button-small"
              aria-disabled={micBlocked || undefined}
              aria-describedby={micHint.id}
              onClick={() => {
                if (micBlocked) return
                setAskedMicrophone(true)
                if (state.listening) engine.stopMicrophone()
                else run(engine.startMicrophone())
              }}
            >
              <Icon name="mic" />
              {state.listening ? 'Stop listening' : 'Start listening'}
            </button>
            <HintButton hint={micHint} topic="the microphone" />
            {/* Always in the document, so screen readers announce it when it fills. */}
            <span className="sound-listening" role="status">
              {state.listening && (
                <>
                  <span className="sound-dot" aria-hidden="true" />
                  Listening
                </>
              )}
            </span>
          </div>
          <HintText hint={micHint}>
            Your browser asks for permission the first time. Sound from the microphone is measured, never played back.
          </HintText>
        </div>
      )}

      {state.error && (
        <p className="font-warning" role="alert" title={state.error.detail || undefined}>
          {errorMessage(state.error, askedMicrophone || state.source === 'microphone')}
        </p>
      )}
      {/* Always in the document, so screen readers announce it when it fills; visually hidden while empty so it adds no gap. */}
      <p className={noSound ? 'panel-notice' : 'visually-hidden'} role="status">
        {noSound ? 'No sound detected.' : null}
      </p>

      <div className="field">
        <div className="sound-row">
          <label htmlFor={presetSelectId} className="sound-row-label">
            Preset
          </label>
          {/* Choosing only selects; Load applies, so browsing the list with the keyboard replaces nothing. */}
          <select
            id={presetSelectId}
            className="preset-select"
            value={presetId}
            aria-describedby={presetHint.id}
            onChange={(e) => {
              setPresetId(e.target.value)
              onPresetChosen()
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button-small"
            aria-label="Load preset"
            onClick={() => {
              const preset = PRESETS.find((p) => p.id === presetId)
              if (preset) onLoadPreset(preset)
            }}
          >
            Load
          </button>
          <HintButton hint={presetHint} topic="Presets" />
        </div>
        <HintText hint={presetHint}>
          Ready-made mappings to start from. Load resets the Geometry and Experimental settings to their defaults (seeds
          kept), then sets the preset up: its own starting values and its mappings, which replace the current ones. Undo (
          {UNDO_KEYS.undo}) brings back the settings and mappings from before.
          <span className="preset-list">
            {PRESETS.map((p) => (
              <span key={p.id} className="preset-item">
                <strong>{p.name}:</strong> {p.description}
              </span>
            ))}
          </span>
        </HintText>
        {/* Always in the document, so screen readers announce it when it fills; visually hidden while empty so it adds no gap. */}
        <p className={presetNotice ? 'panel-notice' : 'visually-hidden'} role="status">
          {presetNotice}
        </p>
      </div>

      <div className="field">
        <div className="sound-row">
          {/* aria-disabled, not disabled: the button keeps keyboard focus when Freeze pauses the sound. Available
              whenever Sound drives (not only on frames that differ), so it does not blink with the beat. */}
          <button
            type="button"
            className="button-small"
            aria-disabled={!status.driving || recording || undefined}
            aria-describedby={[recording && recordingId, freezeHint.id].filter(Boolean).join(' ')}
            onClick={() => {
              if (!status.driving || recording) return
              // Every group it writes is one undo step.
              undoHistory.transaction(() => freezeLive(dispatch))
            }}
          >
            <Icon name="freeze" />
            Freeze
          </button>
          <HintButton hint={freezeHint} topic="Freeze" />
          {/* Not a live region: the status bar announces "Live" politely, and the number changes every second. */}
          {status.driving && <span className="sound-live">Live · {status.fps} fps</span>}
        </div>
        {recording && (
          <p id={recordingId} className="field-hint">
            Freeze is off while recording.
          </p>
        )}
        <HintText hint={freezeHint}>
          Copies the live values into the sliders and pauses the sound, so you can keep or export this moment. Letters that
          react more or less take the shared values.
        </HintText>
      </div>
      {/* Always in the document, so screen readers announce it when it fills; visually hidden while empty so it adds no gap. */}
      <p className={status.slow ? 'font-warning' : 'visually-hidden'} role="status">
        {status.slow
          ? perLetter
            ? 'Too slow to follow the sound: try fewer effects, a shorter text, or less Motion contrast and Pitch reactive.'
            : 'Too slow to follow the sound: try fewer effects or a shorter text.'
          : null}
      </p>
    </SoundBox>
  )
}

/** Sensitivity and Release: one undo step per drag, as the other sliders. */
function setSetting(engine: SoundEngine, settings: FeatureSettings, key: keyof FeatureSettings, value: number) {
  if (value === settings[key]) return
  undoHistory.record(`sound:${key}`)
  engine.setSettings({ [key]: value })
}

/**
 * How the sound is measured: Sensitivity and Release (the engine's settings, saved and undone) beside a meter
 * for every feature. Memoised, so the file position ticking in the rest of the tab never re-renders it.
 */
const InputGroup = memo(function InputGroup({ engine, settings }: { engine: SoundEngine; settings: FeatureSettings }) {
  const sensitivityHint = useHint()
  const releaseHint = useHint()
  const metersHint = useHint()
  const releaseMs = Math.round(settings.releaseMs)

  return (
    <SoundBox legend="Input" className="sound-input">
      <div className="sound-input-row">
        <div className="knob-pair">
          <Knob
            label="Sensitivity"
            value={settings.sensitivity}
            min={SOUND_LIMITS.minSensitivity}
            max={SOUND_LIMITS.maxSensitivity}
            step={SOUND_LIMITS.sensitivityStep}
            defaultValue={DEFAULT_FEATURE_SETTINGS.sensitivity}
            format={(v) => formatDb(v, true)}
            valueText={`${Math.round(settings.sensitivity)} decibels`}
            unit="dB"
            bipolar
            hint={sensitivityHint}
            onChange={(sensitivity) => setSetting(engine, settings, 'sensitivity', sensitivity)}
          />
          <Knob
            label="Release"
            value={settings.releaseMs}
            min={SOUND_LIMITS.minReleaseMs}
            max={SOUND_LIMITS.maxReleaseMs}
            step={SOUND_LIMITS.releaseStepMs}
            defaultValue={DEFAULT_FEATURE_SETTINGS.releaseMs}
            format={(v) => `${Math.round(v)} ms`}
            valueText={`${releaseMs} milliseconds`}
            unit="ms"
            hint={releaseHint}
            onChange={(next) => setSetting(engine, settings, 'releaseMs', next)}
          />
        </div>
        <MeterStrip hintButton={<HintButton hint={metersHint} topic="the meters" />} hintId={metersHint.id} />
      </div>
      <HintText hint={sensitivityHint}>Sensitivity boosts or cuts the input before measuring, for quiet or loud sources.</HintText>
      <HintText hint={releaseHint}>
        Release: how slowly the readings fall back after a sound: short is jumpy, long is calm. They always rise at once.
      </HintText>
      <HintText hint={metersHint}>
        <span className="preset-list">
          {FEATURE_GROUPS.map((group) => (
            <span key={group} className="preset-item">
              <strong>{group}:</strong> {groupHelp[group]}
            </span>
          ))}
        </span>
      </HintText>
    </SoundBox>
  )
})

/** Pitch's scale (log): the meter is empty at the low note and full at the high one. */
const { pitchLowHz, pitchHighHz } = SOUND_LIMITS
const pitchHz = (pitch: number) => pitchLowHz * (pitchHighHz / pitchLowHz) ** pitch

/** What the meters of each group show, in plain words (behind the meters' ⓘ). */
const groupHelp: Record<FeatureGroup, string> = {
  Loudness: `Level is how loud the sound is now, from ${formatDb(SOUND_LIMITS.floorDb)} (empty meter) to ${formatDb(SOUND_LIMITS.ceilingDb)} (full). Swell follows it slowly, for big, calm movements.`,
  Bands:
    'Energy below 250 Hz (Bass), 250–2000 Hz (Mids), and above 2000 Hz (Treble), each compared with its own loudest moment of the last few seconds.',
  Tone: `Brightness: dull, bass-heavy sound reads low; hiss and cymbals read high. Pitch: the note being played or sung, from ${pitchLowHz} Hz (empty meter) to ${pitchHighHz} Hz (full); it holds between notes. Melody jumps when the note changes and falls back with Release.`,
  Rhythm: `Beat jumps to full on every hit, the bass drum included, and falls back with Release. Activity: how busy the sound is; it jumps on sudden changes and stays up while beats come quickly (${SOUND_LIMITS.paceMaxPerSecond} a second fill the meter).`,
  Stereo: 'Pan: where the sound sits, from left to right (lit up or down from the middle). Files only; the microphone reads as centred.',
}

/** Each meter's caption under it: short, as on a mixing desk (the full name is its tooltip and accessible name). */
const SHORT_LABELS: Record<FeatureId, string> = {
  level: 'LVL',
  swell: 'SWL',
  bass: 'BASS',
  mids: 'MIDS',
  treble: 'TREB',
  brightness: 'BRT',
  pitch: 'PTCH',
  melody: 'MEL',
  beat: 'BEAT',
  activity: 'ACT',
  pan: 'PAN',
}

/** A feature's meter elements, filled in by its refs. */
interface Meter {
  feature: FeatureSpec
  bar: HTMLElement | null
  /** The part that moves: the cover over the unlit segments, or Pan's lit segments. */
  fill: HTMLElement | null
  output: HTMLOutputElement | null
}

/** Nothing is running (the file paused or ended, or the microphone not listening): the engine then sends SILENT_FRAME. */
const isIdle = (frame: FeatureFrame) => frame === SILENT_FRAME || frame.time <= 0

/**
 * A meter's number: Level in dB after Sensitivity, matching its meter; Pitch in Hz ("—" in silence, like
 * Level, and once its meter is empty); Pan as the side it leans to ("L 40", "R 40", or "C" in the
 * middle); the rest in percent; "—" with nothing to read.
 */
function readout(feature: FeatureSpec, frame: FeatureFrame): string {
  if (isIdle(frame)) return '—'
  const value = featureValue(frame, feature.id)
  switch (feature.id) {
    case 'level': {
      if (frame.silent) return '—'
      const { floorDb, ceilingDb } = SOUND_LIMITS
      return formatDb(floorDb + value * (ceilingDb - floorDb))
    }
    case 'pitch':
      return frame.silent || barScale(value) === 0 ? '—' : `${Math.round(pitchHz(value))} Hz`
    case 'pan':
      return Math.abs(value) < PAN_CENTRE ? 'C' : `${value < 0 ? 'L' : 'R'} ${Math.round(Math.abs(value) * 100)}`
    default:
      return `${Math.round(value * 100)}%`
  }
}

/** The same for screen readers: Pan in words, and "No reading" for "—". */
function spokenReadout(feature: FeatureSpec, frame: FeatureFrame, text: string): string {
  if (text === '—') return 'No reading'
  if (feature.id !== 'pan') return text
  const value = featureValue(frame, feature.id)
  return Math.abs(value) < PAN_CENTRE ? 'Centre' : `${Math.round(Math.abs(value) * 100)} percent ${value < 0 ? 'left' : 'right'}`
}

/**
 * Writes measured frames straight into the meter elements, outside React (a re-render per frame would
 * be wasted work): the meters every frame, the numbers at most 10 times a second, the values for screen
 * readers at most 4 times. A trailing update makes sure the last frame — usually the silent one sent
 * when playback stops — is always shown in full. Values that did not change are not written again.
 */
class MeterBoard {
  /** One meter per feature, in FEATURES order. */
  readonly meters: readonly Meter[] = FEATURES.map((feature) => ({ feature, bar: null, fill: null, output: null }))
  private latest: FeatureFrame = SILENT_FRAME
  private textAt = -Infinity
  private ariaAt = -Infinity
  private trailing: ReturnType<typeof setTimeout> | undefined

  /** Shows one frame. A stable arrow function, so it can be handed to useSoundFrames as it is. */
  readonly show = (frame: FeatureFrame): void => {
    this.latest = frame
    for (const { feature, fill } of this.meters) {
      if (!fill) continue
      const share = ledShare(featureValue(frame, feature.id), feature.bipolar)
      // A cover over the unlit segments shrinks towards the top; Pan (−1–1) lights segments from the
      // centre, up or (a negative scale mirrors them) down.
      const transform = `scaleY(${feature.bipolar ? share : 1 - share})`
      if (fill.style.transform !== transform) fill.style.transform = transform
    }
    this.updateReadouts()
  }

  /** Cancels the trailing update (the elements are going away). */
  stop(): void {
    clearTimeout(this.trailing)
    this.trailing = undefined
  }

  private updateReadouts(): void {
    const now = performance.now()
    const textDue = now - this.textAt >= TEXT_INTERVAL_MS
    const ariaDue = now - this.ariaAt >= ARIA_INTERVAL_MS
    if (textDue || ariaDue) {
      for (const { feature, bar, output } of this.meters) {
        const text = readout(feature, this.latest)
        if (textDue && output && output.textContent !== text) output.textContent = text
        if (ariaDue && bar) {
          const value = String(Math.round(featureValue(this.latest, feature.id) * 100))
          const spoken = spokenReadout(feature, this.latest, text)
          if (bar.getAttribute('aria-valuenow') !== value) bar.setAttribute('aria-valuenow', value)
          if (bar.getAttribute('aria-valuetext') !== spoken) bar.setAttribute('aria-valuetext', spoken)
        }
      }
      if (textDue) this.textAt = now
      if (ariaDue) this.ariaAt = now
    }
    if ((!textDue || !ariaDue) && this.trailing === undefined) {
      const wait = Math.min(
        textDue ? Infinity : TEXT_INTERVAL_MS - (now - this.textAt),
        ariaDue ? Infinity : ARIA_INTERVAL_MS - (now - this.ariaAt),
      )
      this.trailing = setTimeout(() => {
        this.trailing = undefined
        this.updateReadouts()
      }, Math.max(1, wait))
    }
  }
}

/**
 * A strip of small vertical LED meters, one per feature, fed straight from the engine's frames, and under it
 * the number of one of them: Level, or the meter under the pointer or with focus. The meters are one tab stop:
 * Left and Right (Home, End) move along them, so the keyboard can show every number. Beat is a pulse: it jumps
 * to full on each onset and falls back. Memoised, so a parent's re-render leaves the elements the board writes
 * into alone.
 */
const MeterStrip = memo(function MeterStrip({ hintButton, hintId }: { hintButton: ReactNode; hintId: string }) {
  const [board] = useState(() => new MeterBoard())
  const [shown, setShown] = useState<FeatureId>('level')
  const shownFeature = featureById(shown)
  // The meter that holds the strip's tab stop: the last one focused.
  const [stop, setStop] = useState<FeatureId>('level')

  /**
   * Left, Right, Home and End: focus moves along the meters, which shows each one's number. Enter or Space on a meter
   * picks a control to map its feature to (drag to map from the keyboard, mapDrag.ts).
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLElement && e.target.getAttribute('role') === 'meter') {
      const meter = board.meters.find((m) => m.bar === e.target)
      if (!meter) return
      e.preventDefault()
      // A held key starts one pick, not one per repeat.
      if (e.repeat) return
      startPick(meter.feature.id, e.target)
      return
    }
    const meters = board.meters
    const at = meters.findIndex((m) => m.feature.id === stop)
    const moves: Partial<Record<string, number>> = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: meters.length - 1 }
    const next = moves[e.key]
    if (next === undefined) return
    e.preventDefault()
    meters[Math.min(meters.length - 1, Math.max(0, next))].bar?.focus()
  }

  /** Back to Level when the pointer leaves, unless a meter has focus: then its number stays. */
  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    setShown(e.currentTarget.contains(document.activeElement) ? stop : 'level')
  }

  useSoundFrames(board.show)
  // Start from "nothing measured" before the first paint (the elements render empty).
  useLayoutEffect(() => {
    board.show(SILENT_FRAME)
    return () => board.stop()
  }, [board])

  return (
    <div className="led-strip-wrap">
      <div
        className="led-strip"
        role="group"
        aria-label="Meters"
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setShown('level')
        }}
      >
        {board.meters.map((meter) => (
          // Drag a meter onto a control to map its feature to it (mapDrag.ts).
          <div
            key={meter.feature.id}
            className="led-column"
            title={`${meter.feature.label}: drag onto a control to map it`}
            onPointerEnter={() => setShown(meter.feature.id)}
            onPointerDown={(e) => pressMeter(meter.feature.id, e.nativeEvent)}
          >
            <div
              ref={(el) => {
                meter.bar = el
              }}
              className={meter.feature.bipolar ? 'led-meter led-meter-bipolar' : 'led-meter'}
              tabIndex={meter.feature.id === stop ? 0 : -1}
              onFocus={() => {
                setStop(meter.feature.id)
                setShown(meter.feature.id)
              }}
              role="meter"
              aria-label={meter.feature.label}
              aria-keyshortcuts="Enter Space"
              aria-valuemin={meter.feature.bipolar ? -100 : 0}
              aria-valuemax={100}
              aria-describedby={hintId}
            >
              <div
                ref={(el) => {
                  meter.fill = el
                }}
                className="led-meter-fill"
              />
            </div>
            {/* Hidden from screen readers: the meter carries the full name. */}
            <span className="led-label" aria-hidden="true" data-shown={meter.feature.id === shown || undefined}>
              {SHORT_LABELS[meter.feature.id]}
            </span>
          </div>
        ))}
      </div>
      <div className="led-readout">
        {/* Hidden from screen readers: each meter carries its own name and value. */}
        <span aria-hidden="true">{shownFeature?.label}</span>
        {board.meters.map((meter) => (
          // Every number stays written (MeterBoard fills them all); only the one for the shown meter is on view.
          <output
            key={meter.feature.id}
            aria-hidden="true"
            hidden={meter.feature.id !== shown}
            ref={(el) => {
              meter.output = el
            }}
          />
        ))}
        {hintButton}
      </div>
    </div>
  )
})

/** A response value as a whole percentage: "100%". */
const percent = (value: number) => Math.round(value * 100)

/**
 * Each response value's knob: its label under the knob, its full name (when longer) and ⓘ explanation, and its unit:
 * percent on the knob for a fraction in the store (scale 100), or milliseconds as they are (Glide).
 */
const RESPONSE_FIELDS: Record<Exclude<keyof ResponseSettings, 'plain' | 'holdMs'>, { label: string; name?: string; hint: string; unit?: 'ms' }> = {
  strength: {
    label: 'Strength',
    hint:
      'Strength scales how far every mapping moves the letters: 0% holds them still, 200% moves them twice as far (sliders ' +
      'stop at their ends). Bigger moves are held back more often by the flash limit.',
  },
  contrast: {
    label: 'Contrast',
    name: 'Motion contrast',
    hint:
      'Motion contrast lets each letter react by its own amount: some stay calm while others move several times as far, and ' +
      'which ones lead drifts every few seconds. Strength sets the overall amount. Freeze writes the shared values. Can lower ' +
      'the frame rate.',
  },
  pitchReactive: {
    label: 'Pitch reactive',
    hint:
      'Pitch reactive: the low notes of the melody move the letters on the left more, its high notes those on the right, so a ' +
      'tune sweeps across the text. Follows the range of the last few seconds of notes. Needs a clear note, such as a voice ' +
      'or one instrument. Can lower the frame rate.',
  },
  melody: {
    label: 'Melody',
    name: 'Melody tracking',
    hint:
      'Melody tracking adds movement each time the melody moves to a new note, even at a steady loudness. Melody can also be ' +
      'mapped like any other reading.',
  },
  glideMs: {
    label: 'Glide',
    unit: 'ms',
    hint:
      'Glide lets the letters travel to each new shape instead of jumping: every anchor slides from where it is to where the ' +
      'sound puts it, over this time, along its effect\'s own path (Whorl turns the rings round their centre; the other ' +
      'effects move straight). 0 ms shows each shape at once. Only the canvas, the preview and videos glide; the shapes, ' +
      'markers and Freeze are the same at any value. Off while your system asks for reduced motion.',
  },
}

const RESPONSE_KEYS = Object.keys(RESPONSE_FIELDS) as (keyof typeof RESPONSE_FIELDS)[]

/**
 * How the letters answer the sound: the response values over every mapping (the mapping store), five knobs in a
 * row (fewer on a narrow panel), and Reset sound, which also resets Input's Sensitivity and Release. All
 * seven are saved and undone; presets leave them alone.
 */
function ResponseGroup({ engine, settings }: { engine: SoundEngine; settings: FeatureSettings }) {
  const { response } = useMappingState()
  const hints = {
    strength: useHint(),
    contrast: useHint(),
    pitchReactive: useHint(),
    melody: useHint(),
    glideMs: useHint(),
  }
  const isDefault =
    settings.sensitivity === DEFAULT_FEATURE_SETTINGS.sensitivity &&
    settings.releaseMs === DEFAULT_FEATURE_SETTINGS.releaseMs &&
    RESPONSE_KEYS.every((key) => response[key] === DEFAULT_RESPONSE[key])

  const resetSound = () =>
    undoHistory.transaction(() => {
      undoHistory.record(null)
      engine.setSettings(DEFAULT_FEATURE_SETTINGS)
      // Return to plain and its Hold, in the Transport, stay as they are.
      mappingStore.setResponse(Object.fromEntries(RESPONSE_KEYS.map((key) => [key, DEFAULT_RESPONSE[key]])))
    })

  return (
    <SoundBox legend="Response">
      <div className="knob-row">
        {RESPONSE_KEYS.map((field) => {
          const { label, name, unit } = RESPONSE_FIELDS[field]
          const { min, max, step } = RESPONSE_LIMITS[field]
          // Milliseconds as they are; fractions as whole percentages.
          const scale = unit === 'ms' ? 1 : 100
          const shown = (v: number) => Math.round(v * scale)
          const value = shown(response[field])
          return (
            <Knob
              key={field}
              label={label}
              name={name}
              value={value}
              min={shown(min)}
              max={shown(max)}
              step={shown(step)}
              defaultValue={shown(DEFAULT_RESPONSE[field])}
              format={(v) => (unit === 'ms' ? `${v} ms` : formatPercent(v))}
              valueText={unit === 'ms' ? `${value} milliseconds` : `${value} percent`}
              unit={unit ?? '%'}
              hint={hints[field]}
              onChange={(next) => mappingStore.setResponse({ [field]: next / scale })}
            />
          )
        })}
      </div>
      {RESPONSE_KEYS.map((field) => (
        <HintText key={field} hint={hints[field]}>
          {RESPONSE_FIELDS[field].hint}
        </HintText>
      ))}
      <button type="button" className="button-small" disabled={isDefault} onClick={resetSound}>
        <Icon name="reset" />
        Reset sound
      </button>
    </SoundBox>
  )
}

/**
 * What Add mapping adds: Level → Distortion's amount (Noise amplitude) at +50%, or the first target no
 * mapping uses yet. A target that already acts comes first, so adding a row switches nothing another
 * row needs (Tolerance and Segments per curve each need their own Mode). A double-click on a row's Depth
 * knob puts back the same +50%.
 */
const DEFAULT_TARGET = 'distortion.amount'
const DEFAULT_DEPTH = 0.5

function nextTarget(mappings: readonly Mapping[], params: DrivenParams): string | undefined {
  const used = new Set(mappings.map((m) => m.target))
  if (!used.has(DEFAULT_TARGET) && targetById(DEFAULT_TARGET)) return DEFAULT_TARGET
  const free = TARGETS.filter((t) => !used.has(t.id))
  return (free.find((t) => t.inactive(params) === null) ?? free[0] ?? TARGETS[0])?.id
}

/** A target as an option, "Section · Label" (e.g. "Distortion · Noise amplitude"), or the label alone when both are the same ("Seed"). */
const targetOption = (t: TargetSpec) => (
  <option key={t.id} value={t.id}>
    {t.section === t.label ? t.label : `${t.section} · ${t.label}`}
  </option>
)

const targetGroups = TARGET_GROUPS.map(({ label, targets }) => (
  <optgroup key={label} label={label}>
    {targets.map(targetOption)}
  </optgroup>
))

/** The features as options, grouped as the meters' explanation groups them. */
const featureOptions = FEATURE_GROUPS.map((group) => (
  <optgroup key={group} label={group}>
    {FEATURES.filter((f) => f.group === group).map((f) => (
      <option key={f.id} value={f.id}>
        {f.label}
      </option>
    ))}
  </optgroup>
))

interface ModulationGroupProps {
  params: DrivenParams
  /** The loaded font's variable axes (see SoundControlsProps). */
  axes: readonly VariationAxis[] | undefined
  /** What picking each row's target switched on, by mapping id. */
  notices: ReadonlyMap<string, string>
  /** Switches on what `target` needs to act and sets the row's notice (see SoundControls). */
  onActivate: (id: string, target: TargetSpec | undefined) => void
  /** A row is being removed. */
  onRemove: (id: string) => void
}

/**
 * The mappings: which feature moves which slider and how far, one compact row each, with the rest of a row
 * behind its expand button (one row open at a time), and Add mapping. The mappings live in their own store
 * (mappingStore), so the sliders keep their values; the live values reach the canvas through useLiveFrame in App.
 */
function ModulationGroup({ params, axes, notices, onActivate, onRemove }: ModulationGroupProps) {
  const { mappings } = useMappingState()
  const limitId = useId()
  // The row whose details are open; null with none.
  const [expanded, setExpanded] = useState<string | null>(null)
  const full = mappings.length >= MAPPING_LIMITS.maxMappings
  // The settings while the switch rows fire: a row they make act says so.
  const switched = useMemo(() => whileSwitchesFire(params, mappings), [params, mappings])
  const addBlocked = full || TARGETS.length === 0

  const addMapping = () => {
    if (addBlocked) return
    // From the store, not this render: two quick clicks must not both pick the same target.
    const target = nextTarget(mappingStore.getState().mappings, params)
    // The row and what it switches on are one undo step.
    undoHistory.transaction(() => {
      const id = target ? mappingStore.add('level', target, DEFAULT_DEPTH) : null
      if (target && id) onActivate(id, targetById(target))
    })
  }

  return (
    <SoundBox legend="Modulation">
      {mappings.length > 0 && (
        <ul className="mapping-list">
          {mappings.map((mapping, index) => (
            <MappingRow
              key={mapping.id}
              mapping={mapping}
              index={index}
              params={params}
              switched={switched}
              axes={axes}
              open={expanded === mapping.id}
              notice={notices.get(mapping.id) ?? null}
              span={sharedRange(mappings, mapping.target)}
              onToggle={() => setExpanded((current) => (current === mapping.id ? null : mapping.id))}
              onActivate={(target) => onActivate(mapping.id, target)}
              onRemove={() => onRemove(mapping.id)}
            />
          ))}
        </ul>
      )}

      <div className="field">
        {/* aria-disabled, not disabled: the button keeps keyboard focus when the last free slot fills, so the limit note stays reachable. */}
        <button
          type="button"
          className="button-small mapping-add"
          aria-disabled={addBlocked || undefined}
          aria-describedby={full ? limitId : undefined}
          onClick={addMapping}
        >
          <Icon name="add" />
          Add mapping
        </button>
        {full && (
          <p id={limitId} className="field-hint">
            Up to {MAPPING_LIMITS.maxMappings} mappings.
          </p>
        )}
      </div>
    </SoundBox>
  )
}

/** What Rate means on a seed, from the jump and flash limits (jumps.ts, flash.ts). */
const rateHelp =
  'How often the seed moves on; each new seed is a new variant. With Beat, 100% moves on at every hit and 50% ' +
  `at every other one. With other features, it moves on faster the higher they read, up to about ${Math.round(JUMP_LIMITS.maxRate)} ` +
  `times a second at 100%. Seeds and sliders share one limit of ${FLASH_LIMITS.maxFlashes} flashes a second, so busy sliders leave fewer jumps.`

const MODE_LABELS: Record<MappingMode, string> = { follow: 'Follow', trigger: 'Trigger', toggle: 'Toggle' }

/** What the shaping settings do (mapping.ts, shaping.ts). */
const shapingHelp =
  'Mode: Follow moves with the sound; Trigger gives one push to the full Depth each time the sound rises past Gate, ' +
  'falling back over Smooth; Toggle flips the target between its slider value and the full Depth at each rise. On a ' +
  'seed, Trigger and Toggle move it on once per rise. Gate: below it the sound counts as silence. Curve: Log lifts quiet ' +
  'sound, Exp keeps it low until it gets loud. Smooth: slows this mapping on top of Release. Range: the part of the ' +
  'slider this mapping may move the target within; mappings on one slider share the outer edges of their Ranges. On a ' +
  'seed there is no Range, Curve and Smooth act only in Follow, and with Beat Gate, Curve and Smooth do nothing; with ' +
  'Beat in Trigger or Toggle every hit fires, so there is no Gate. A switch (a checkbox such as Burst) only flips: ' +
  'Trigger turns it the other way for as long as Smooth, Toggle at one rise and back at the next; it has no Depth, ' +
  "Range or Curve. Knobs that do nothing are not shown."

/** Curve as read under its knob: "Lin", "Log 40", "Exp 40" (percent of the way to the strongest curve). */
function formatCurve(percent: number): string {
  return percent === 0 ? 'Lin' : `${percent < 0 ? 'Log' : 'Exp'} ${Math.abs(percent)}`
}

/** Curve as screen readers read it: "Linear", "Logarithmic, 40 percent". */
function curveText(percent: number): string {
  return percent === 0 ? 'Linear' : `${percent < 0 ? 'Logarithmic' : 'Exponential'}, ${Math.abs(percent)} percent`
}

interface MappingRowProps {
  mapping: Mapping
  index: number
  params: DrivenParams
  /** The settings while every switch row fires (whileSwitchesFire). */
  switched: DrivenParams
  /** The loaded font's variable axes: their targets join the select. */
  axes: readonly VariationAxis[] | undefined
  /** The row's details are on view. */
  open: boolean
  /** What picking this row's target switched on ("Turned on Ripple."), or null. */
  notice: string | null
  /** The Range shared by every mapping on this row's target (sharedRange), if any drives it. */
  span: readonly [number, number] | undefined
  /** Opens or closes the row's details. */
  onToggle: () => void
  /** Switches on what `target` needs to act and sets the row's notice. */
  onActivate: (target: TargetSpec | undefined) => void
  /** The row is being removed. */
  onRemove: () => void
}

/**
 * One mapping on one line: on/off, Feature → Target, a small Depth knob (Rate on a seed) and the expand button.
 * The details below it hold the rest (what Rate means, Remove) and are where more of a mapping's settings go.
 * Under the row, what picking the target switched on; or, while the target does nothing now, why, with Enable.
 */
function MappingRow({ mapping, index, params, switched, axes, open, notice, span, onToggle, onActivate, onRemove }: MappingRowProps) {
  const id = useId()
  const rateHint = useHint()
  const shapingHint = useHint()
  const targetSelect = useRef<HTMLSelectElement>(null)
  const n = index + 1
  const feature = featureById(mapping.feature)
  const target = targetById(mapping.target)
  // Off on the sliders but turned on by a switch row while it fires: still offered Enable, and told it acts meanwhile.
  const off = target?.inactive(params) ?? null
  const bySwitch = off !== null && switched !== params && target?.inactive(switched) === null
  const inactive = off && bySwitch ? `${off} Until then, it acts only while a switch mapping turns it on.` : off
  const canEnable = inactive !== null && (target?.activate(params) ?? null) !== null
  // A seed jumps at a Rate (0–100%) instead of moving by a signed Depth.
  const jump = target?.kind === 'jump'
  // A switch (a checkbox) only flips, at each rise (Trigger, for as long as its pulse lasts) or from one rise to the
  // next (Toggle): it has no Depth, Range or Curve, and Follow is not offered (but listed, checked, for a switch row
  // restored or imported in Follow, which still flips at half the level, so the Mode group always shows its mode).
  const flip = target?.kind === 'switch'
  // The font's axes as targets; an axis target the font lacks still shows, so the select stays truthful.
  const axisOptions = axes?.length ? axisTargets() : []
  const missingAxis = target?.tab === 'axes' && !axisOptions.some((t) => t.id === target.id)
  const modes = flip && shapingOf(mapping).mode !== 'follow' ? MAPPING_MODES.filter((mode) => mode !== 'follow') : MAPPING_MODES
  const amountPercent = Math.round((jump ? Math.abs(mapping.depth) : mapping.depth) * 100)
  const amountLabel = jump ? 'Rate' : 'Depth'
  // The notice fills its status region only once the row is in the document, so a notice from Add
  // mapping is announced too (a status region that arrives with its text is often not read out).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const shownNotice = mounted && !inactive ? notice : null
  const update = (patch: Partial<Omit<Mapping, 'id'>>) => mappingStore.update(mapping.id, patch)
  const shaping = shapingOf(mapping)
  const percent = (share: number) => Math.round(share * 100)
  // A drop on a control made this row ('new') or found it ('found'): marked until it is used (mapDrag.ts).
  const marked = useMarked(mapping.id)
  // On a seed only rises count in Trigger and Toggle, and Beat's hits count as they are (in Trigger and Toggle on a
  // slider too): knobs that would do nothing there are not shown (as Range is not on a seed).
  const event = feature?.event !== undefined
  const showGate = !event || (!jump && shaping.mode === 'follow')
  const showCurveSmooth = !jump || (!event && shaping.mode === 'follow')
  const showCurve = showCurveSmooth && !flip
  // Another mapping on the target widens this row's Range (they share the outer edges): say so under the Range.
  const widened =
    !jump && !flip && mapping.enabled && mapping.depth !== 0 && span !== undefined && (span[0] < shaping.rangeMin || span[1] > shaping.rangeMax)
      ? span
      : undefined
  // Keyboard browsing (arrow keys or typing on a closed select) changes the target at every option it passes, so
  // what a target needs is switched on only once the choice is made, on Enter or on leaving the select; the
  // settings passed on the way stay as they were. A pick with the mouse is made at once.
  const keyboard = useRef(false)
  const pendingTarget = useRef(false)
  const commitTarget = (value: string) => {
    if (!pendingTarget.current) return
    pendingTarget.current = false
    onActivate(targetById(value))
  }

  return (
    <li
      className="mapping"
      data-off={!mapping.enabled || undefined}
      data-marked={marked ?? undefined}
      onPointerDownCapture={() => clearMark(mapping.id)}
      onFocusCapture={() => clearMark(mapping.id)}
    >
      <div className="mapping-row" role="group" aria-label={`Mapping ${n}`}>
        {/* The on/off light: a checkbox drawn as a square LED. */}
        <span className="mapping-led">
          <input
            type="checkbox"
            checked={mapping.enabled}
            aria-label={`Use mapping ${n}`}
            title={`Use mapping ${n}`}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span className="mapping-led-light" aria-hidden="true" />
        </span>
        <select
          className="mapping-feature"
          aria-label={`Mapping ${n} feature`}
          title={feature?.label}
          value={mapping.feature}
          onChange={(e) => update({ feature: e.target.value as FeatureId })}
        >
          {/* A feature this version does not know (none should exist) still shows, so the select stays truthful. */}
          {!feature && (
            <option value={mapping.feature} disabled>
              {mapping.feature}
            </option>
          )}
          {featureOptions}
        </select>
        <span className="mapping-arrow" aria-hidden="true">
          →
        </span>
        <select
          ref={targetSelect}
          className="mapping-target"
          aria-label={`Mapping ${n} target`}
          aria-describedby={inactive ? `${id}-inactive` : undefined}
          title={target ? (target.section === target.label ? target.label : `${target.section} · ${target.label}`) : undefined}
          value={mapping.target}
          onPointerDown={() => (keyboard.current = false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTarget(e.currentTarget.value)
            else keyboard.current = true
          }}
          onBlur={(e) => commitTarget(e.currentTarget.value)}
          onChange={(e) => {
            const next = targetById(e.target.value)
            const value = e.target.value
            // The new target and what it switches on are one undo step.
            undoHistory.transaction(() => {
              // A seed's Rate is never negative: a negative Depth turns positive in the same update. A switch has no
              // Follow (it becomes Toggle) and no Depth to set, so a Depth of 0, which would leave it off, becomes the default.
              const patch: Partial<Omit<Mapping, 'id'>> = { target: value }
              if (next?.kind === 'jump' && mapping.depth < 0) patch.depth = -mapping.depth
              if (next?.kind === 'switch') {
                if (shaping.mode === 'follow') patch.mode = 'toggle'
                if (mapping.depth === 0) patch.depth = DEFAULT_DEPTH
              }
              update(patch)
              if (keyboard.current) {
                pendingTarget.current = true
                // Nothing to switch on yet; this only clears the last target's notice.
                onActivate(undefined)
              } else {
                onActivate(next)
              }
            })
          }}
        >
          {/* A target this version does not know (none should exist) still shows, so the select stays truthful. */}
          {!target && (
            <option value={mapping.target} disabled>
              {mapping.target}
            </option>
          )}
          {targetGroups}
          {(axisOptions.length > 0 || missingAxis) && (
            <optgroup label="Variable axes">
              {axisOptions.map(targetOption)}
              {missingAxis && target && (
                <option value={target.id} disabled>
                  {`${target.label} (not in this font)`}
                </option>
              )}
            </optgroup>
          )}
        </select>
        {flip ? (
          <span className="mapping-depth-none" aria-hidden="true" />
        ) : (
          <Knob
            size="small"
            label={amountLabel}
            name={`${amountLabel}, mapping ${n}`}
            hideLabel
            title={amountLabel}
            value={amountPercent}
            min={jump ? 0 : -100}
            max={100}
            step={1}
            defaultValue={DEFAULT_DEPTH * 100}
            format={(v) => formatPercent(v, !jump)}
            valueText={`${amountPercent} percent`}
            unit="%"
            bipolar={!jump}
            describedBy={jump ? rateHint.id : undefined}
            onChange={(next) => update({ depth: next / 100 })}
          />
        )}
        <button
          type="button"
          className="button-small button-icon mapping-expand"
          aria-expanded={open}
          aria-controls={`${id}-details`}
          aria-label={`Mapping ${n} details`}
          title={open ? 'Hide details' : 'Show details'}
          onClick={onToggle}
        >
          <Icon name="chevron" />
        </button>
      </div>
      {/* The rest of the mapping: its shaping, then what Rate means on a seed, then the actions. */}
      <div id={`${id}-details`} className="mapping-details" role="group" aria-label={`Mapping ${n} details`} hidden={!open}>
        <span className="field-title">
          <span id={`${id}-mode`}>Mode</span>
          <HintButton hint={shapingHint} topic="Shaping" />
        </span>
        <div className="segmented segmented-small mapping-mode" role="radiogroup" aria-labelledby={`${id}-mode`} aria-describedby={shapingHint.id}>
          {modes.map((mode) => (
            <label key={mode} className="segment-option">
              <input
                type="radio"
                name={`${id}-mode`}
                value={mode}
                checked={shaping.mode === mode}
                aria-label={`${MODE_LABELS[mode]}, mapping ${n}`}
                onChange={() => update({ mode })}
              />
              <span>{MODE_LABELS[mode]}</span>
            </label>
          ))}
        </div>
        <HintText hint={shapingHint}>{shapingHelp}</HintText>
        {(showGate || showCurveSmooth) && (
          <div className="mapping-shaping">
            {showGate && (
              <Knob
                size="small"
                label="Gate"
                name={`Gate, mapping ${n}`}
                value={percent(shaping.gate)}
                min={SHAPING_LIMITS.gate.min * 100}
                max={SHAPING_LIMITS.gate.max * 100}
                step={1}
                defaultValue={DEFAULT_SHAPING.gate * 100}
                format={(v) => formatPercent(v)}
                valueText={`${percent(shaping.gate)} percent`}
                unit="%"
                onChange={(next) => update({ gate: next / 100 })}
              />
            )}
            {showCurve && (
              <Knob
                size="small"
                label="Curve"
                name={`Curve, mapping ${n}`}
                value={percent(shaping.curve)}
                min={SHAPING_LIMITS.curve.min * 100}
                max={SHAPING_LIMITS.curve.max * 100}
                step={1}
                defaultValue={DEFAULT_SHAPING.curve * 100}
                format={formatCurve}
                valueText={curveText(percent(shaping.curve))}
                bipolar
                onChange={(next) => update({ curve: next / 100 })}
              />
            )}
            {showCurveSmooth && (
              <Knob
                size="small"
                label="Smooth"
                name={`Smooth, mapping ${n}`}
                value={shaping.smoothMs}
                min={SHAPING_LIMITS.smoothMs.min}
                max={SHAPING_LIMITS.smoothMs.max}
                step={SHAPING_LIMITS.smoothMs.step}
                defaultValue={DEFAULT_SHAPING.smoothMs}
                format={(v) => `${v} ms`}
                valueText={`${shaping.smoothMs} milliseconds`}
                unit="ms"
                onChange={(next) => update({ smoothMs: next })}
              />
            )}
          </div>
        )}
        {!jump && !flip && (
          <div className="mapping-range">
            <span className="field-title">Range</span>
            <RangeControl
              name={`Range, mapping ${n}`}
              low={percent(shaping.rangeMin)}
              high={percent(shaping.rangeMax)}
              min={0}
              max={100}
              step={1}
              minGap={percent(SHAPING_LIMITS.minSpan)}
              format={(low, high) => `${low}–${high}%`}
              valueText={(v) => `${v} percent`}
              describedBy={widened ? `${id}-widened` : undefined}
              onChange={({ low, high }) =>
                update({ ...(low !== undefined ? { rangeMin: low / 100 } : {}), ...(high !== undefined ? { rangeMax: high / 100 } : {}) })
              }
            />
            {widened && (
              <p id={`${id}-widened`} className="panel-notice">
                {`Another mapping on this target widens the Range to ${percent(widened[0])}–${percent(widened[1])}%.`}
              </p>
            )}
          </div>
        )}
        {jump && (
          <span className="field-title">
            <span>Rate</span>
            <HintButton hint={rateHint} topic="Rate" />
          </span>
        )}
        {jump && <HintText hint={rateHint}>{rateHelp}</HintText>}
        <div className="mapping-actions">
          <button
            type="button"
            className="button-small mapping-remove"
            aria-label={`Remove mapping ${n}`}
            onClick={(e) => {
              // Hand focus to the next row's expand button, else the previous row's, else Add mapping, before this
              // row unmounts, so keyboard focus does not fall back to the page.
              const row = e.currentTarget.closest('li')
              const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLButtonElement>('.mapping-expand')
              const next = neighbour ?? row?.closest('.group-body')?.querySelector<HTMLButtonElement>('.mapping-add')
              next?.focus()
              onRemove()
              mappingStore.remove(mapping.id)
            }}
          >
            <Icon name="close" />
            Remove
          </button>
        </div>
      </div>
      {inactive && (
        <div className="panel-notice mapping-note">
          <span id={`${id}-inactive`}>{inactive}</span>
          {canEnable && (
            <button
              type="button"
              className="button-small"
              aria-label={`Enable, mapping ${n}`}
              aria-describedby={`${id}-inactive`}
              onClick={() => {
                // The button goes once the target acts: hand focus to the row's Target first, so keyboard
                // focus does not fall back to the page; the notice then says what changed.
                targetSelect.current?.focus()
                onActivate(target)
              }}
            >
              Enable
            </button>
          )}
        </div>
      )}
      {/* Always in the document, so screen readers announce it when it fills; visually hidden while empty so it adds no gap. */}
      <p className={shownNotice ? 'panel-notice' : 'visually-hidden'} role="status">
        {shownNotice}
      </p>
    </li>
  )
}
