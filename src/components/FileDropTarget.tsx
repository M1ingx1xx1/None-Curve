/** Local font import entry. Phase A is a UI placeholder only; files are not read or parsed. */
export default function FileDropTarget() {
  return (
    <div className="drop-target">
      <p className="drop-title">Drop a font file</p>
      <p className="drop-hint">.ttf and .otf supported. Files stay in your browser and are never uploaded.</p>
      <button type="button" disabled title="Font import is not implemented yet">
        Choose file<span className="pending">Soon</span>
      </button>
    </div>
  )
}
