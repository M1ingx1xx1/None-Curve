import { memo, useId, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode } from 'react'
import type { GeometryParams } from '../geometry/types'
import type { SoundEngine } from '../sound/engine'
import { freezeLive, useLiveStatus } from '../sound/live'
import { CONTINUOUS_FEATURES, TARGETS, targetById, type ContinuousFeature, type Mapping, type TargetSpec } from '../sound/mapping'
import { MAPPING_LIMITS, mappingStore, useMappingState } from '../sound/mappingStore'
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
  ['off', 'Off'],
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
/** How long Beat and Kick stay lit after an onset (ms). */
const LIGHT_MS = 120

/** NaN reads as 0. */
const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0)

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

type MeterKey = 'level' | 'low' | 'mid' | 'high' | 'brightness'
type LightKey = 'beat' | 'kick'

const meterKeys: MeterKey[] = ['level', 'low', 'mid', 'high', 'brightness']
const lightKeys: LightKey[] = ['beat', 'kick']

interface MeterNodes {
  bar: HTMLElement | null
  fill: HTMLElement | null
  output: HTMLOutputElement | null
}

/** Nothing is running (Sound off, or the file paused or ended): the engine then sends SILENT_FRAME. */
const isIdle = (frame: FeatureFrame) => frame === SILENT_FRAME || frame.time <= 0

/** A meter's number: Level in dB after Sensitivity, matching its bar; the others in percent; "—" with nothing to read. */
function readout(key: MeterKey, frame: FeatureFrame): string {
  if (isIdle(frame)) return '—'
  if (key === 'level') {
    if (frame.silent) return '—'
    const { floorDb, ceilingDb } = SOUND_LIMITS
    return formatDb(floorDb + clamp01(frame.level) * (ceilingDb - floorDb))
  }
  return `${Math.round(clamp01(frame[key]) * 100)}%`
}

/**
 * Writes measured frames straight into the meter elements, outside React (a re-render per frame would
 * be wasted work): the bars every frame, the numbers at most 10 times a second, the values for screen
 * readers at most 4 times. A trailing update makes sure the last frame — usually the silent one sent
 * when playback stops — is always shown in full.
 */
class MeterBoard {
  readonly meters: Record<MeterKey, MeterNodes> = {
    level: { bar: null, fill: null, output: null },
    low: { bar: null, fill: null, output: null },
    mid: { bar: null, fill: null, output: null },
    high: { bar: null, fill: null, output: null },
    brightness: { bar: null, fill: null, output: null },
  }
  readonly lights: Record<LightKey, HTMLElement | null> = { beat: null, kick: null }
  private latest: FeatureFrame = SILENT_FRAME
  private textAt = -Infinity
  private ariaAt = -Infinity
  private trailing: ReturnType<typeof setTimeout> | undefined
  private lightTimers: Record<LightKey, ReturnType<typeof setTimeout> | undefined> = { beat: undefined, kick: undefined }

  /** Shows one frame. A stable arrow function, so it can be handed to useSoundFrames as it is. */
  readonly show = (frame: FeatureFrame): void => {
    this.latest = frame
    for (const key of meterKeys) {
      const fill = this.meters[key].fill
      if (fill) fill.style.transform = `scaleX(${clamp01(frame[key])})`
    }
    for (const key of lightKeys) if (frame[key]) this.flash(key)
    this.updateReadouts()
  }

  /** Cancels the timers and puts the lights out (the elements are going away). */
  stop(): void {
    clearTimeout(this.trailing)
    this.trailing = undefined
    for (const key of lightKeys) {
      clearTimeout(this.lightTimers[key])
      this.lightTimers[key] = undefined
      this.lights[key]?.classList.remove('is-on')
    }
  }

  private flash(key: LightKey): void {
    const light = this.lights[key]
    if (!light) return
    light.classList.add('is-on')
    clearTimeout(this.lightTimers[key])
    this.lightTimers[key] = setTimeout(() => light.classList.remove('is-on'), LIGHT_MS)
  }

  private updateReadouts(): void {
    const now = performance.now()
    const textDue = now - this.textAt >= TEXT_INTERVAL_MS
    const ariaDue = now - this.ariaAt >= ARIA_INTERVAL_MS
    if (textDue || ariaDue) {
      for (const key of meterKeys) {
        const { bar, output } = this.meters[key]
        const text = readout(key, this.latest)
        if (textDue && output) output.textContent = text
        if (ariaDue && bar) {
          bar.setAttribute('aria-valuenow', String(Math.round(clamp01(this.latest[key]) * 100)))
          bar.setAttribute('aria-valuetext', text === '—' ? 'No reading' : text)
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
 * Meters for every feature, fed straight from the engine's frames. Memoised without props, so the
 * file position ticking in the rest of the tab never re-renders it.
 */
const LevelsGroup = memo(function LevelsGroup() {
  const [board] = useState(() => new MeterBoard())
  const levelHint = useHint()
  const bandsHint = useHint()
  const brightnessHint = useHint()
  const lightsHint = useHint()

  useSoundFrames(board.show)
  // Start from "nothing measured" before the first paint (the elements render empty).
  useLayoutEffect(() => {
    board.show(SILENT_FRAME)
    return () => board.stop()
  }, [board])

  /**
   * A labelled bar with its number. `help` is the ⓘ explanation that describes it; the meter that
   * carries the explanation (Low, for the three bands) also gets its button and text.
   */
  const meter = (key: MeterKey, label: string, help?: HintState, explanation?: { topic: string; text: string }) => (
    <div className="field">
      <div className="field-head">
        <span className="field-title">
          <span className="field-label">{label}</span>
          {help && explanation && <HintButton hint={help} topic={explanation.topic} />}
        </span>
        {/* Hidden from screen readers: an output is a live region, and the meter carries the same value. */}
        <output
          aria-hidden="true"
          ref={(el) => {
            board.meters[key].output = el
          }}
        />
      </div>
      <div
        ref={(el) => {
          board.meters[key].bar = el
        }}
        className="sound-meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-describedby={help?.id}
      >
        <div
          ref={(el) => {
            board.meters[key].fill = el
          }}
          className="sound-meter-fill"
        />
      </div>
      {help && explanation && <HintText hint={help}>{explanation.text}</HintText>}
    </div>
  )

  return (
    <fieldset className="group sound">
      <legend>Levels</legend>
      <div className="group-body">
        {meter('level', 'Level', levelHint, { topic: 'Level', text: 'Loudness (RMS), from −60 dB (empty bar) to 0 dB (full).' })}
        {meter('low', 'Low', bandsHint, {
          topic: 'Low, Mid, and High',
          text: 'Energy below 250 Hz, 250–2000 Hz, and above 2000 Hz, each compared with its own loudest moment of the last few seconds.',
        })}
        {meter('mid', 'Mid', bandsHint)}
        {meter('high', 'High', bandsHint)}
        {meter('brightness', 'Brightness', brightnessHint, {
          topic: 'Brightness',
          text: 'Where the energy sits: dull, bass-heavy sound reads low; hiss and cymbals read high.',
        })}

        <div className="field">
          <div className="sound-lights">
            {lightKeys.map((key) => (
              <span key={key} className="sound-light-item">
                <span
                  ref={(el) => {
                    board.lights[key] = el
                  }}
                  className="sound-light"
                  aria-hidden="true"
                />
                {key === 'beat' ? 'Beat' : 'Kick'}
              </span>
            ))}
            <HintButton hint={lightsHint} topic="Beat and Kick" />
          </div>
          <HintText hint={lightsHint}>Beat lights on every onset; Kick only on sudden bass, such as the bass drum.</HintText>
        </div>
      </div>
    </fieldset>
  )
})

/** Depth as a signed percentage with a real minus sign: "+40%", "−20%", "0%". */
function formatDepth(depth: number): string {
  const n = Math.round(depth * 100)
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n)}%`
}

/** What Add mapping adds: Level → Distortion's amount (Noise amplitude) at +50%, or the first target no mapping uses yet. */
const DEFAULT_TARGET = 'distortion.amount'
const DEFAULT_DEPTH = 0.5

function nextTarget(mappings: readonly Mapping[]): string | undefined {
  const used = new Set(mappings.map((m) => m.target))
  if (!used.has(DEFAULT_TARGET) && targetById(DEFAULT_TARGET)) return DEFAULT_TARGET
  return TARGETS.find((t) => !used.has(t.id))?.id ?? TARGETS[0]?.id
}

/** The targets of one tab as options, "Section · Label" (e.g. "Distortion · Noise amplitude"). */
const targetOptions = (tab: TargetSpec['tab']) =>
  TARGETS.filter((t) => t.tab === tab).map((t) => (
    <option key={t.id} value={t.id}>
      {`${t.section} · ${t.label}`}
    </option>
  ))

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
  const limitId = useId()
  const reducedId = useId()
  const reducedNote = reducedMotion && !drive
  const full = mappings.length >= MAPPING_LIMITS.maxMappings
  const addBlocked = full || TARGETS.length === 0

  const addMapping = () => {
    if (addBlocked) return
    // From the store, not this render: two quick clicks must not both pick the same target.
    const target = nextTarget(mappingStore.getState().mappings)
    if (target) mappingStore.add('level', target, DEFAULT_DEPTH)
  }

  return (
    <fieldset className="group sound">
      <legend>Mappings</legend>
      {/* One fixed child: Chrome ends a slider drag when the fieldset's own children change. */}
      <div className="group-body">
        <div className="field">
          <div className="field field-toggle">
            <input
              id="sound-drive"
              type="checkbox"
              checked={drive}
              aria-describedby={reducedNote ? `${reducedId} ${driveHint.id}` : driveHint.id}
              onChange={(e) => mappingStore.setDrive(e.target.checked)}
            />
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

        {mappings.length > 0 && (
          <ul className="mapping-list">
            {mappings.map((mapping, index) => (
              <MappingRow key={mapping.id} mapping={mapping} index={index} params={params} />
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

/** One mapping: Feature → Target, Depth, on/off, and remove; a note below when its target does nothing now. */
function MappingRow({ mapping, index, params }: { mapping: Mapping; index: number; params: GeometryParams }) {
  const id = useId()
  const n = index + 1
  const target = targetById(mapping.target)
  const inactive = target?.inactive(params) ?? null
  const depthPercent = Math.round(mapping.depth * 100)
  const update = (patch: Partial<Omit<Mapping, 'id'>>) => mappingStore.update(mapping.id, patch)

  return (
    <li className="mapping">
      <div className="mapping-row" role="group" aria-label={`Mapping ${n}`}>
        <div className="mapping-route">
          <select
            className="mapping-feature"
            aria-label={`Mapping ${n} feature`}
            value={mapping.feature}
            onChange={(e) => update({ feature: e.target.value as ContinuousFeature })}
          >
            {CONTINUOUS_FEATURES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="mapping-arrow" aria-hidden="true">
            →
          </span>
          <select
            className="mapping-target"
            aria-label={`Mapping ${n} target`}
            aria-describedby={inactive ? `${id}-inactive` : undefined}
            value={mapping.target}
            onChange={(e) => update({ target: e.target.value })}
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
            Depth<span className="visually-hidden">, mapping {n}</span>
          </label>
          <input
            id={`${id}-depth`}
            type="range"
            min={-100}
            max={100}
            step={5}
            value={depthPercent}
            aria-valuetext={`${depthPercent} percent`}
            onChange={(e) => update({ depth: Number(e.target.value) / 100 })}
          />
          {/* Hidden from screen readers: an output is a live region, and the slider says the same. */}
          <output htmlFor={`${id}-depth`} className="mapping-depth" aria-hidden="true">
            {formatDepth(mapping.depth)}
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
              mappingStore.remove(mapping.id)
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
      {inactive && (
        <p id={`${id}-inactive`} className="panel-notice">
          {inactive}
        </p>
      )}
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
