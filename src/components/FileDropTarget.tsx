import { useRef } from 'react'
import LocalFileInput from './LocalFileInput'

interface FileDropTargetProps {
  onLocalFile: (file: File) => void
  onOpenGoogleFonts: () => void
}

/** Empty-canvas prompt. Dropping a file anywhere on the canvas is handled by CanvasViewport. */
export default function FileDropTarget({ onLocalFile, onOpenGoogleFonts }: FileDropTargetProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="drop-target">
      <p className="drop-title">Drop a font file here</p>
      <p className="drop-hint">.ttf, .otf, .woff, and .woff2. Files stay in your browser and are never uploaded.</p>
      <div className="drop-actions">
        <button type="button" onClick={() => fileRef.current?.click()}>
          Choose file
        </button>
        <button type="button" onClick={onOpenGoogleFonts}>
          Google Fonts
        </button>
      </div>
      <LocalFileInput ref={fileRef} onFile={onLocalFile} />
    </div>
  )
}
