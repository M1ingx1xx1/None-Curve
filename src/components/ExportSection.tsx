interface ExportSectionProps {
  disabled: boolean
  lastExport: { fileName: string; at: string } | null
  onOpenExport: () => void
}

/** Export entry in the toolbar, plus the note on the planned sound module. */
export default function ExportSection({ disabled, lastExport, onOpenExport }: ExportSectionProps) {
  return (
    <section className="group export-entry" aria-labelledby="export-entry-title">
      <h2 id="export-entry-title" className="section-title">
        Export
      </h2>
      <p className="field-hint">SVG of the current glyph or the specimen, or an OpenType font of the polygon outlines.</p>
      <button type="button" className="button-small" disabled={disabled} onClick={onOpenExport}>
        Export…
      </button>
      {disabled && <p className="field-hint">Load a font to export.</p>}
      {lastExport && <p className="field-hint">Last export: {lastExport.fileName}</p>}
      <div className="planned">
        <h3>Sound carving · Planned</h3>
        <p>
          Optional extension: Sound → Carving Logic → Letterform. Maps sound features such as volume, pitch, and rhythm to
          carving parameters such as depth, pressure, and stroke width. Not implemented yet.
        </p>
      </div>
    </section>
  )
}
