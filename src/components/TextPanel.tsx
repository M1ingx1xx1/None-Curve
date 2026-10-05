import { useId, type Ref } from 'react'
import type { LoadedFont } from '../font/model'
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
}

// Line breaks are explicit: the specimen does not wrap, so long samples are broken into lines here.
const samples: [string, string][] = [
  [
    'Lorem ipsum',
    [
      'Lorem ipsum dolor sit amet, consectetur',
      'adipiscing elit, sed do eiusmod tempor',
      'incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud',
      'exercitation ullamco laboris nisi ut aliquip',
      'ex ea commodo consequat.',
    ].join('\n'),
  ],
  ['Pangrams', 'The quick brown fox jumps over the lazy dog.\nCrazy Fredrick bought many very exquisite opal jewels.'],
  ['Spacing', 'Hamburgefontsiv\nAVATAR Typography, Tolerance'],
  ['Alphabet', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789\n.,:;!?()[]{}&@#$%*'],
]

/** Bottom right, left part: the text shown in the result canvas. */
export default function TextPanel({ font, text, scene, pending, onTextChange, inputRef, onInputFocus }: TextPanelProps) {
  const id = useId()
  const length = [...text].length

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
            value=""
            onChange={(e) => {
              const sample = samples.find(([label]) => label === e.target.value)
              if (sample) onTextChange(sample[1])
            }}
          >
            <option value="">Sample…</option>
            {samples.map(([label]) => (
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
