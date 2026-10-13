import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode } from 'react'
import type { GeometryParams } from '../geometry/types'
import type { SoundEngine } from '../sound/engine'
import { JUMP_LIMITS } from '../sound/jumps'
import { freezeLive, useLiveStatus } from '../sound/live'
import {
  FEATURE_GROUPS,
  FEATURES,
  TARGETS,
  applyPatches,
  featureById,
  featureValue,
  targetById,
  type Activation,
  type FeatureGroup,
  type FeatureId,
  type FeatureSpec,
  type Mapping,
  type TargetSpec,
} from '../sound/mapping'
import { MAPPING_LIMITS, mappingStore, useMappingState } from '../sound/mappingStore'
import { PRESETS, presetSettings } from '../sound/presets'
import {
  DEFAULT_FEATURE_SETTINGS,
  SILENT_FRAME,
  SOUND_LIMITS,
  type FeatureFrame,
  type FeatureSettings,
  type SoundError,
  type SoundErrorKind,
  type SoundSource,
  type SoundState,
} from '../sound/types'
import { useSoundEngine, useSoundFrames, useSoundState } from '../sound/useSound'
import type { Action } from '../state/editorState'
import { HintButton, HintText, useHint, type HintState } from './Hint'
import Icon from './Icon'

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
}

/** The message for an error. "Unsupported" depends on what was being opened: Web Audio or the microphone. */
const errorMessage = (error: SoundError, microphone: boolean) =>
  error.kind === 'unsupported' && microphone ? 'This browser cannot use the microphone.' : errorText[error.kind]

/** Meter numbers change at most this often (ms), so they stay readable; the bars move every frame. */
const TEXT_INTERVAL_MS = 100
/** Screen readers get new meter values at most this often (ms). */
const ARIA_INTERVAL_MS = 250
/** Pan reads "C" (centred) while it leans less than this far to either side. */
const PAN_CENTRE = 0.05
/** Bars are drawn to a thousandth of their length (under a pixel), so a bar that holds still costs no style change. */
const barScale = (value: number) => Math.round(value * 1000) / 1000

/** "−18 dB" with a real minus sign; `signed` also puts "+" before positive values. */
function formatDb(db: number, signed = false): string {
  const n = Math.round(db)
  return `${n < 0 ? '−' : n > 0 && signed ? '+' : ''}${Math.abs(n)} dB`
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

interface SoundControlsProps {
  /** The slider values: they decide which mapping targets currently act (their step or effect is on). */
  params: GeometryParams
  /** For Freeze, which copies the live values into the sliders. */
  dispatch: Dispatch<Action>
}

/**
 * The Sound tab: a source — a local audio file or the microphone — meters for what the analyser
 * measures in it, and the mappings that let those measurements move the Geometry and Experimental
 * sliders live (see docs/SOUND_PLAN.md). Nothing depends on a font, so no control is disabled without one.
 */
function SoundControls({ params, dispatch }: SoundControlsProps) {
  const engine = useSoundEngine()
  const state = useSoundState()
  const introHint = useHint()

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

      <SourceGroup engine={engine} state={state} />
      <LevelsGroup />
      <MappingsGroup params={params} dispatch={dispatch} />
      <AnalysisGroup engine={engine} settings={state.settings} />
    </>
  )
}

// Its props (all the parameters and dispatch) stay the same while Sound drives the letters.
export default memo(SoundControls)

function SourceGroup({ engine, state }: { engine: SoundEngine; state: SoundState }) {
  const micHint = useHint()
  const fileInput = useRef<HTMLInputElement>(null)
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

  const chooseSource = (source: SoundSource) => {
    setAskedMicrophone(source === 'microphone')
    // Choosing a source never opens the microphone; only Start listening does.
    run(engine.setSource(source))
  }

  return (
    <fieldset className="group sound">
      <legend>Source</legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <div className="segmented" role="radiogroup" aria-label="Source">
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

        {state.source === 'file' && (
          <>
            <div className="sound-row">
              {/* aria-disabled, not disabled: the button keeps keyboard focus while the file it opened loads. */}
              <button
                type="button"
                className="button-small"
                aria-disabled={state.busy || undefined}
                onClick={() => {
                  if (state.busy) return
                  setAskedMicrophone(false)
                  fileInput.current?.click()
                }}
              >
                <Icon name="upload" />
                Choose file
              </button>
              {state.fileName !== null && (
                <span className="sound-file" title={state.fileName}>
                  <span className="sound-file-name">{state.fileName}</span>
                  {loaded && <span className="sound-file-duration">{formatTime(state.duration)}</span>}
                </span>
              )}
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

            <div className="sound-row">
              <button
                type="button"
                className="button-small"
                disabled={!loaded || state.busy}
                onClick={() => (state.playing ? engine.pause() : run(engine.play()))}
              >
                <Icon name={state.playing ? 'pause' : 'play'} />
                {state.playing ? 'Pause' : 'Play'}
              </button>
              <div className="field field-toggle">
                <input id="sound-loop" type="checkbox" checked={state.loop} onChange={(e) => engine.setLoop(e.target.checked)} />
                <label htmlFor="sound-loop">Loop</label>
              </div>
            </div>

            <div className="field">
              <div className="field-head">
                <span className="field-title">
                  <label htmlFor="sound-position">Position</label>
                </span>
                {/* Not a live region: it changes every second while playing. The slider gives the same time (held while playing). */}
                <output htmlFor="sound-position" aria-live="off">
                  {formatTime(position)} / {formatTime(state.duration)}
                </output>
              </div>
              <input
                id="sound-position"
                type="range"
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
            </div>
          </>
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
      </div>
    </fieldset>
  )
}

/** Pitch's scale (log): the bar is empty at the low note and full at the high one. */
const { pitchLowHz, pitchHighHz } = SOUND_LIMITS
const pitchHz = (pitch: number) => pitchLowHz * (pitchHighHz / pitchLowHz) ** pitch

/** Each group's ⓘ explanation, in plain words. */
const groupHelp: Record<FeatureGroup, string> = {
  Loudness: `Level is how loud the sound is now, from ${formatDb(SOUND_LIMITS.floorDb)} (empty bar) to ${formatDb(SOUND_LIMITS.ceilingDb)} (full). Swell follows it slowly, for big, calm movements.`,
  Bands:
    'Energy below 250 Hz (Bass), 250–2000 Hz (Mids), and above 2000 Hz (Treble), each compared with its own loudest moment of the last few seconds.',
  Tone: `Brightness: dull, bass-heavy sound reads low; hiss and cymbals read high. Pitch: the note being played or sung, from ${pitchLowHz} Hz (empty bar) to ${pitchHighHz} Hz (full); it holds between notes.`,
  Rhythm: `Beat jumps to full on every hit, the bass drum included, and falls back with Smoothing. Activity: how busy the sound is; it jumps on sudden changes and stays up while beats come quickly (${SOUND_LIMITS.paceMaxPerSecond} a second fill the bar).`,
  Stereo: 'Pan: where the sound sits, from left to right. Files only; the microphone reads as centred.',
}

/** A feature's meter elements, filled in by its refs. */
interface Meter {
  feature: FeatureSpec
  bar: HTMLElement | null
  fill: HTMLElement | null
  output: HTMLOutputElement | null
}

/** Nothing is running (the file paused or ended, or the microphone not listening): the engine then sends SILENT_FRAME. */
const isIdle = (frame: FeatureFrame) => frame === SILENT_FRAME || frame.time <= 0

/**
 * A meter's number: Level in dB after Sensitivity, matching its bar; Pitch in Hz ("—" in silence, like
 * Level, and once its bar is empty); Pan as the side it leans to ("L 40", "R 40", or "C" in the
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
 * be wasted work): the bars every frame, the numbers at most 10 times a second, the values for screen
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
      // Pan runs −1–1: its fill starts at the centre, and a negative scale mirrors it to the left.
      const transform = `scaleX(${barScale(featureValue(frame, feature.id))})`
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
 * Meters for every feature, fed straight from the engine's frames, under a small heading per group.
 * Memoised without props, so the file position ticking in the rest of the tab never re-renders it.
 */
const LevelsGroup = memo(function LevelsGroup() {
  const [board] = useState(() => new MeterBoard())

  useSoundFrames(board.show)
  // Start from "nothing measured" before the first paint (the elements render empty).
  useLayoutEffect(() => {
    board.show(SILENT_FRAME)
    return () => board.stop()
  }, [board])

  return (
    <fieldset className="group sound">
      <legend>Levels</legend>
      <div className="group-body">
        {FEATURE_GROUPS.map((group) => (
          <MeterGroup key={group} group={group} meters={board.meters.filter((m) => m.feature.group === group)} />
        ))}
      </div>
    </fieldset>
  )
})

/**
 * One group's meters, each on one line: label, bar, and number. Beat is a pulse: its bar jumps to full
 * on each onset and falls back. The group's ⓘ explanation describes every meter in it.
 */
function MeterGroup({ group, meters }: { group: FeatureGroup; meters: readonly Meter[] }) {
  const hint = useHint()
  const titleId = useId()

  return (
    <div className="meter-group" role="group" aria-labelledby={titleId}>
      <span className="field-title meter-group-title">
        <span id={titleId}>{group}</span>
        <HintButton hint={hint} topic={group} />
      </span>
      {meters.map((meter) => (
        <div key={meter.feature.id} className="meter-row">
          {/* Hidden from screen readers: the meter carries the same name. */}
          <span className="meter-label" aria-hidden="true">
            {meter.feature.label}
          </span>
          <div
            ref={(el) => {
              meter.bar = el
            }}
            className={meter.feature.bipolar ? 'sound-meter sound-meter-bipolar' : 'sound-meter'}
            role="meter"
            aria-label={meter.feature.label}
            aria-valuemin={meter.feature.bipolar ? -100 : 0}
            aria-valuemax={100}
            aria-describedby={hint.id}
          >
            <div
              ref={(el) => {
                meter.fill = el
              }}
              className="sound-meter-fill"
            />
          </div>
          {/* Hidden from screen readers: an output is a live region, and the meter carries the same value. */}
          <output
            aria-hidden="true"
            ref={(el) => {
              meter.output = el
            }}
          />
        </div>
      ))}
      <HintText hint={hint}>{groupHelp[group]}</HintText>
    </div>
  )
}

/** Depth as a signed percentage with a real minus sign: "+40%", "−20%", "0%". */
function formatDepth(depth: number): string {
  const n = Math.round(depth * 100)
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n)}%`
}

/**
 * What Add mapping adds: Level → Distortion's amount (Noise amplitude) at +50%, or the first target no
 * mapping uses yet. A target that already acts comes first, so adding a row switches nothing another
 * row needs (Tolerance and Segments per curve each need their own Mode).
 */
const DEFAULT_TARGET = 'distortion.amount'
const DEFAULT_DEPTH = 0.5

function nextTarget(mappings: readonly Mapping[], params: GeometryParams): string | undefined {
  const used = new Set(mappings.map((m) => m.target))
  if (!used.has(DEFAULT_TARGET) && targetById(DEFAULT_TARGET)) return DEFAULT_TARGET
  const free = TARGETS.filter((t) => !used.has(t.id))
  return (free.find((t) => t.inactive(params) === null) ?? free[0] ?? TARGETS[0])?.id
}

/** The targets of one tab as options, "Section · Label" (e.g. "Distortion · Noise amplitude"), or the label alone when both are the same ("Seed"). */
const targetOptions = (tab: TargetSpec['tab']) =>
  TARGETS.filter((t) => t.tab === tab).map((t) => (
    <option key={t.id} value={t.id}>
      {t.section === t.label ? t.label : `${t.section} · ${t.label}`}
    </option>
  ))

/** The features as options, grouped as the meters are. */
const featureOptions = FEATURE_GROUPS.map((group) => (
  <optgroup key={group} label={group}>
    {FEATURES.filter((f) => f.group === group).map((f) => (
      <option key={f.id} value={f.id}>
        {f.label}
      </option>
    ))}
  </optgroup>
))

/** Applies an activation's (or a preset's) changes to the sliders, as Freeze does. */
function applyActivation({ patches }: Pick<Activation, 'patches'>, dispatch: Dispatch<Action>): void {
  // `group` and `patch` always match; TypeScript cannot pair a union key with its value here.
  for (const { group, patch } of patches) dispatch({ type: 'updateParams', group, patch } as Action)
}

/**
 * The mappings: which feature moves which slider and how far, the Drive letters switch over all of
 * them, the live frame rate, and Freeze. The mappings live in their own store (mappingStore), so the
 * sliders keep their values; the live values reach the canvas through useLiveParams in App.
 */
function MappingsGroup({ params, dispatch }: { params: GeometryParams; dispatch: Dispatch<Action> }) {
  const { mappings, drive, reducedMotion } = useMappingState()
  const status = useLiveStatus()
  const driveHint = useHint()
  const freezeHint = useHint()
  const presetHint = useHint()
  const limitId = useId()
  const reducedId = useId()
  const presetSelectId = useId()
  const [presetId, setPresetId] = useState(PRESETS[0]?.id ?? '')
  // What the last Load did, under the Preset row until the next Load or until another preset is chosen in the list.
  const [presetNotice, setPresetNotice] = useState<string | null>(null)
  // What picking a target switched on, by mapping id, shown under its row until the row's target changes again.
  const [notices, setNotices] = useState<ReadonlyMap<string, string>>(new Map())
  const reducedNote = reducedMotion && !drive
  const full = mappings.length >= MAPPING_LIMITS.maxMappings
  const addBlocked = full || TARGETS.length === 0

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
  const activate = (id: string, target: TargetSpec | undefined) => {
    const activation = target?.activate(params) ?? null
    if (activation) applyActivation(activation, dispatch)
    setNotice(id, activation?.notice ?? null)
  }

  const addMapping = () => {
    if (addBlocked) return
    // From the store, not this render: two quick clicks must not both pick the same target.
    const target = nextTarget(mappingStore.getState().mappings, params)
    const id = target ? mappingStore.add('level', target, DEFAULT_DEPTH) : null
    if (target && id) activate(id, targetById(target))
  }

  /**
   * Resets the Geometry and Experimental settings to their defaults (seeds kept), sets the chosen
   * preset's start values and replaces the mappings with its own (presetSettings). The rows should then
   * need nothing; should one, what it needs is switched on as when a target is picked by hand, row by
   * row against the settings the rows before it left (so a switch is turned on, and named, once).
   */
  const loadPreset = () => {
    const preset = PRESETS.find((p) => p.id === presetId)
    if (!preset) return
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
  }

  return (
    <fieldset className="group sound">
      <legend>Mappings</legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <div className="field">
          <div className="field field-toggle">
            {/* A checkbox announced and drawn as an on/off switch: the track and knob are its sibling. */}
            <span className="switch">
              <input
                id="sound-drive"
                type="checkbox"
                role="switch"
                checked={drive}
                aria-describedby={reducedNote ? `${reducedId} ${driveHint.id}` : driveHint.id}
                onChange={(e) => mappingStore.setDrive(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
            </span>
            <span className="field-title">
              <label htmlFor="sound-drive">Drive letters</label>
              <HintButton hint={driveHint} topic="Drive letters" />
            </span>
          </div>
          {reducedNote && (
            <p id={reducedId} className="field-hint">
              Off because your system asks for reduced motion.
            </p>
          )}
          <HintText hint={driveHint}>
            Sound moves the letters only while this is on and a file plays or the microphone listens. The sliders keep
            their own values; a marker on each driven slider shows the live value.
          </HintText>
        </div>

        <div className="field">
          <div className="field-head">
            <span className="field-title">
              <label htmlFor={presetSelectId}>Preset</label>
              <HintButton hint={presetHint} topic="Presets" />
            </span>
          </div>
          <div className="sound-row">
            {/* Choosing only selects; Load applies, so browsing the list with the keyboard replaces nothing. */}
            <select
              id={presetSelectId}
              className="preset-select"
              value={presetId}
              aria-describedby={presetHint.id}
              onChange={(e) => {
                setPresetId(e.target.value)
                setPresetNotice(null)
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="button-small" onClick={loadPreset}>
              Load
            </button>
          </div>
          <HintText hint={presetHint}>
            Ready-made mappings to start from. Load resets the Geometry and Experimental settings to their defaults
            (seeds kept), then sets the preset up: its own starting values and its mappings, which replace the current
            ones.
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

        {mappings.length > 0 && (
          <ul className="mapping-list">
            {mappings.map((mapping, index) => (
              <MappingRow
                key={mapping.id}
                mapping={mapping}
                index={index}
                params={params}
                notice={notices.get(mapping.id) ?? null}
                onActivate={(target) => activate(mapping.id, target)}
                onRemove={() => setNotice(mapping.id, null)}
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

        <div className="field">
          <div className="sound-row">
            {/* aria-disabled, not disabled: the button keeps keyboard focus when Freeze pauses the sound. Available
                whenever Sound drives (not only on frames that differ), so it does not blink with the beat. */}
            <button
              type="button"
              className="button-small"
              aria-disabled={!status.driving || undefined}
              aria-describedby={freezeHint.id}
              onClick={() => {
                if (!status.driving) return
                freezeLive(dispatch)
              }}
            >
              <Icon name="freeze" />
              Freeze
            </button>
            <HintButton hint={freezeHint} topic="Freeze" />
            {/* Not a live region: the status bar announces "Live" politely, and the number changes every second. */}
            {status.driving && <span className="sound-live">Live · {status.fps} fps</span>}
          </div>
          <HintText hint={freezeHint}>
            Copies the live values into the sliders and pauses the sound, so you can keep or export this moment.
          </HintText>
        </div>
        {/* Always in the document, so screen readers announce it when it fills; visually hidden while empty so it adds no gap. */}
        <p className={status.slow ? 'font-warning' : 'visually-hidden'} role="status">
          {status.slow ? 'Too slow to follow the sound: try fewer effects or a shorter text.' : null}
        </p>
      </div>
    </fieldset>
  )
}

/** What Rate means on a seed, from the jump limits (jumps.ts). */
const rateHelp =
  'How often the seed moves on; each new seed is a new variant. With Beat, 100% moves on at every hit and 50% ' +
  `at every other one. With other features, it moves on faster the higher they read, up to about ${Math.round(JUMP_LIMITS.maxRate)} ` +
  `times a second at 100%. All seeds together jump at most about ${Math.round(JUMP_LIMITS.maxJumps / (JUMP_LIMITS.windowMs / 1000))} times a second.`

interface MappingRowProps {
  mapping: Mapping
  index: number
  params: GeometryParams
  /** What picking this row's target switched on ("Turned on Ripple."), or null. */
  notice: string | null
  /** Switches on what `target` needs to act and sets the row's notice (see MappingsGroup). */
  onActivate: (target: TargetSpec | undefined) => void
  /** The row is being removed. */
  onRemove: () => void
}

/**
 * One mapping: Feature → Target, Depth (Rate on a seed), on/off, and remove. Below it, what picking the
 * target switched on; or, while the target does nothing now, why, with Enable.
 */
function MappingRow({ mapping, index, params, notice, onActivate, onRemove }: MappingRowProps) {
  const id = useId()
  const rateHint = useHint()
  const targetSelect = useRef<HTMLSelectElement>(null)
  const n = index + 1
  const feature = featureById(mapping.feature)
  const target = targetById(mapping.target)
  const inactive = target?.inactive(params) ?? null
  const canEnable = inactive !== null && (target?.activate(params) ?? null) !== null
  // A seed jumps at a Rate (0–100%) instead of moving by a signed Depth.
  const jump = target?.kind === 'jump'
  const amountPercent = Math.round((jump ? Math.abs(mapping.depth) : mapping.depth) * 100)
  // The notice fills its status region only once the row is in the document, so a notice from Add
  // mapping is announced too (a status region that arrives with its text is often not read out).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const shownNotice = mounted && !inactive ? notice : null
  const update = (patch: Partial<Omit<Mapping, 'id'>>) => mappingStore.update(mapping.id, patch)
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
    <li className="mapping">
      <div className="mapping-row" role="group" aria-label={`Mapping ${n}`}>
        <div className="mapping-route">
          <select
            className="mapping-feature"
            aria-label={`Mapping ${n} feature`}
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
            value={mapping.target}
            onPointerDown={() => (keyboard.current = false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTarget(e.currentTarget.value)
              else keyboard.current = true
            }}
            onBlur={(e) => commitTarget(e.currentTarget.value)}
            onChange={(e) => {
              const next = targetById(e.target.value)
              // A seed's Rate is never negative: a negative Depth turns positive in the same update.
              update(next?.kind === 'jump' && mapping.depth < 0 ? { target: e.target.value, depth: -mapping.depth } : { target: e.target.value })
              if (keyboard.current) {
                pendingTarget.current = true
                // Nothing to switch on yet; this only clears the last target's notice.
                onActivate(undefined)
              } else {
                onActivate(next)
              }
            }}
          >
            {/* A target this version does not know (none should exist) still shows, so the select stays truthful. */}
            {!target && (
              <option value={mapping.target} disabled>
                {mapping.target}
              </option>
            )}
            <optgroup label="Geometry">{targetOptions('geometry')}</optgroup>
            <optgroup label="Experimental">{targetOptions('experimental')}</optgroup>
          </select>
        </div>
        <div className="mapping-amount">
          <label htmlFor={`${id}-depth`} className="mapping-depth-label">
            {jump ? 'Rate' : 'Depth'}
            <span className="visually-hidden">, mapping {n}</span>
          </label>
          {jump && <HintButton hint={rateHint} topic="Rate" />}
          <input
            id={`${id}-depth`}
            type="range"
            min={jump ? 0 : -100}
            max={100}
            step={5}
            value={amountPercent}
            aria-valuetext={`${amountPercent} percent`}
            aria-describedby={jump ? rateHint.id : undefined}
            onChange={(e) => update({ depth: Number(e.target.value) / 100 })}
          />
          {/* Hidden from screen readers: an output is a live region, and the slider says the same. */}
          <output htmlFor={`${id}-depth`} className="mapping-depth" aria-hidden="true">
            {jump ? `${amountPercent}%` : formatDepth(mapping.depth)}
          </output>
          <input
            type="checkbox"
            checked={mapping.enabled}
            aria-label={`Use mapping ${n}`}
            title={`Use mapping ${n}`}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <button
            type="button"
            className="button-small mapping-remove"
            aria-label={`Remove mapping ${n}`}
            title={`Remove mapping ${n}`}
            onClick={(e) => {
              // Hand focus to the next row's Remove, else the previous row's, else Add mapping, before this
              // row unmounts, so keyboard focus does not fall back to the page.
              const row = e.currentTarget.closest('li')
              const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLButtonElement>('.mapping-remove')
              const next = neighbour ?? row?.closest('.group-body')?.querySelector<HTMLButtonElement>('.mapping-add')
              next?.focus()
              onRemove()
              mappingStore.remove(mapping.id)
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
      {jump && <HintText hint={rateHint}>{rateHelp}</HintText>}
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

function AnalysisGroup({ engine, settings }: { engine: SoundEngine; settings: FeatureSettings }) {
  const sensitivityHint = useHint()
  const smoothingHint = useHint()
  const isDefault =
    settings.sensitivity === DEFAULT_FEATURE_SETTINGS.sensitivity && settings.releaseMs === DEFAULT_FEATURE_SETTINGS.releaseMs
  const releaseMs = Math.round(settings.releaseMs)

  return (
    <fieldset className="group sound">
      <legend>Analysis</legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <RangeField
          id="sound-sensitivity"
          label="Sensitivity"
          value={settings.sensitivity}
          min={SOUND_LIMITS.minSensitivity}
          max={SOUND_LIMITS.maxSensitivity}
          step={1}
          display={formatDb(settings.sensitivity, true)}
          valueText={`${Math.round(settings.sensitivity)} decibels`}
          hint={sensitivityHint}
          hintText="Boosts or cuts the input before measuring, for quiet or loud sources."
          onChange={(sensitivity) => engine.setSettings({ sensitivity })}
        />
        <RangeField
          id="sound-smoothing"
          label="Smoothing"
          value={settings.releaseMs}
          min={SOUND_LIMITS.minReleaseMs}
          max={SOUND_LIMITS.maxReleaseMs}
          step={10}
          display={`${releaseMs} ms`}
          valueText={`${releaseMs} milliseconds`}
          hint={smoothingHint}
          hintText="How slowly the readings fall back after a sound: short is jumpy, long is calm. They always rise at once."
          onChange={(releaseMs) => engine.setSettings({ releaseMs })}
        />

        <button type="button" className="button-small" disabled={isDefault} onClick={() => engine.setSettings(DEFAULT_FEATURE_SETTINGS)}>
          <Icon name="reset" />
          Reset sound
        </button>
      </div>
    </fieldset>
  )
}

interface RangeFieldProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  display: ReactNode
  valueText: string
  hint: HintState
  hintText: string
  onChange: (value: number) => void
}

/** A labelled slider with its value and an ⓘ explanation (as on the Experimental tab). */
function RangeField({ id, label, value, min, max, step, display, valueText, hint, hintText, onChange }: RangeFieldProps) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-title">
          <label htmlFor={id}>{label}</label>
          <HintButton hint={hint} topic={label} />
        </span>
        <output htmlFor={id}>{display}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        aria-describedby={hint.id}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <HintText hint={hint}>{hintText}</HintText>
    </div>
  )
}
