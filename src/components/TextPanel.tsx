import { useId } from 'react'
import type { LoadedFont } from '../font/model'
import { SPECIMEN_MAX_CHARS, type SpecimenScene } from '../specimen/scene'

interface TextPanelProps {
  font: LoadedFont | null
  text: string
  scene: SpecimenScene | null
  pending: boolean
  onTextChange: (text: string) => void
}

const samples: [string, string][] = [
  ['Pangram', 'The quick brown fox jumps over the lazy dog.'],
  ['Round letters', 'OO oo 00 BOB GOOD 808'],
  ['Spacing', 'Hamburgefonstiv\nAVATAR Type, Tolerance'],
]

/** Area B: the text set in the result canvas. */
export default function TextPanel({ font, text, scene, pending, onTextChange }: TextPanelProps) {
  const id = useId()
  const length = [...text].length

  const notes: string[] = []
  if (scene) {
    notes.push(`${scene.glyphCount} glyphs in ${scene.lines.length} line${scene.lines.length === 1 ? '' : 's'}`)
    notes.push(scene.kerning ? 'kerning from the font applied' : 'this font has no kerning data')
    if (scene.failedGlyphs) notes.push(`${scene.failedGlyphs} glyphs failed to process`)
  }

  return (
    <section className="panel text-panel" aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <h2 id={`${id}-title`}>Text</h2>
        <div className="preset-row" role="group" aria-label="Sample texts">
          {samples.map(([label, sample]) => (
            <button key={label} type="button" className="button-small" onClick={() => onTextChange(sample)}>
              {label}
            </button>
          ))}
          <button type="button" className="button-small" disabled={!text} onClick={() => onTextChange('')}>
            Clear
          </button>
        </div>
      </div>
      <label htmlFor={id} className="visually-hidden">
        Text to preview
      </label>
      <textarea
        id={id}
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
