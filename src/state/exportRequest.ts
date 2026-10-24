// Asks the page to open the Export dialog on a format, from places App does not render directly (the Sound tab's
// Record group opens it on Video for an audio file). App listens (onExportRequest) and opens the dialog.

type Listener = (format: 'video') => void

let listener: Listener | null = null

/** Opens the Export dialog on `format`. */
export function requestExport(format: 'video'): void {
  listener?.(format)
}

/** App's listener; one at a time. Returns the unsubscribe. */
export function onExportRequest(next: Listener): () => void {
  listener = next
  return () => {
    if (listener === next) listener = null
  }
}
