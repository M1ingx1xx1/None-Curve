import { useEffect, useId, useState, type Ref } from 'react'
import type { LoadedFont } from '../font/model'
import type { TextCase } from '../specimen/artboard'
import { SAMPLES } from '../specimen/samples'
import { SPECIMEN_MAX_CHARS, type SpecimenScene } from '../specimen/scene'

interface TextPanelProps {
  font: LoadedFont | null
  text: string
  scene: SpecimenScene | null
  pending: boolean
  onTextChange: (text: string) => void
  /** The textarea, so the glyph list can insert at the cursor. */
  inputRef?: Ref<HTMLTextAreaElement>
  onInputFocus?: () => void
  /** Case shown on the canvas and exported; the typed text is not changed. */
  textCase: TextCase
  onTextCaseChange: (textCase: TextCase) => void
}

/** Value of the hidden menu entry shown once the text no longer matches a sample. */
const EDITED = 'edited'

const cases: [Exclude<TextCase, 'none'>, string, string][] = [
  ['upper', 'All caps', 'AA'],
  ['lower', 'Lower', 'aa'],
  ['title', 'Title case', 'Aa'],
]


/** Bottom right, left part: the text shown in the result canvas. */
export default function TextPanel({
  font,
  text,
  scene,
  pending,
  onTextChange,
  inputRef,
  onInputFocus,
  textCase,
  onTextCaseChange,
}: TextPanelProps) {
  const id = useId()
  const length = [...text].length
  // The menu always names a sample: the one loaded, or the last one picked marked "edited" once the
  // text changes. The edited entry is a hidden option, so picking that sample again reloads it.
  const loaded = SAMPLES.find((s) => s.text === text) ?? null
  const [lastSample, setLastSample] = useState(() => (loaded ?? SAMPLES[0]).label)
  useEffect(() => {
    if (loaded) setLastSample(loaded.label)
  }, [loaded])

  const notes: string[] = []
  if (scene) {
    notes.push(`${scene.glyphCount} glyphs in ${scene.lines.length} line${scene.lines.length === 1 ? '' : 's'}`)
    notes.push(scene.kerning ? 'kerning from the font applied' : 'this font has no kerning data')
    if (scene.failedGlyphs) notes.push(`${scene.failedGlyphs} glyphs failed to process`)
  }

  return (
    <section className="text-panel" aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <h2 id={`${id}-title`}>Text</h2>
        <div className="text-actions">
          <label htmlFor={`${id}-sample`} className="visually-hidden">
            Sample text
          </label>
          <select
            id={`${id}-sample`}
            value={loaded?.label ?? EDITED}
            title="Sample text"
            onChange={(e) => {
              const sample = SAMPLES.find((s) => s.label === e.target.value)
              if (sample) onTextChange(sample.text)
            }}
          >
            <option value={EDITED} hidden disabled>
              {lastSample} (edited)
            </option>
            {SAMPLES.map(({ label }) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="button-small" disabled={!text} onClick={() => onTextChange('')}>
            Clear
          </button>
        </div>
      </div>
      <label htmlFor={id} className="visually-hidden">
        Text to preview
      </label>
      {/* Toggles: pressing the active one goes back to the text as typed. */}
      <div className="case-row segmented segmented-small" role="group" aria-label="Letter case on the canvas">
        {cases.map(([value, label, sample]) => (
          <button
            key={value}
            type="button"
            aria-pressed={textCase === value}
            title={`${label} on the canvas and in exports; your text stays as typed`}
            onClick={() => onTextCaseChange(textCase === value ? 'none' : value)}
          >
            <span className="case-sample" aria-hidden="true">
              {sample}
            </span>{' '}
            {label}
          </button>
        ))}
      </div>
      <textarea
        ref={inputRef}
        id={id}
        onFocus={onInputFocus}
        className="text-input"
        value={text}
        spellCheck={false}
        placeholder="Type the text to preview. Enter starts a new line."
        aria-describedby={`${id}-notes`}
        onChange={(e) => onTextChange(e.target.value)}
      />
      <div id={`${id}-notes`} className="text-notes" aria-live="polite" aria-busy={pending}>
        <p className="field-hint">
          {length} / {SPECIMEN_MAX_CHARS} characters
          {font ? ` · ${notes.join(' · ')}` : ' · load a font to preview'}
          {textCase !== 'none' && ` · shown in ${cases.find(([v]) => v === textCase)?.[1].toLowerCase()}`}
        </p>
        {scene && scene.missingCharacters.length > 0 && (
          <p className="font-warning">
            Not in this font (dashed boxes on the canvas): {scene.missingCharacters.join(' ')}
          </p>
        )}
        {scene?.truncated && <p className="font-warning">Only the first {SPECIMEN_MAX_CHARS} characters are shown.</p>}
      </div>
    </section>
  )
}
