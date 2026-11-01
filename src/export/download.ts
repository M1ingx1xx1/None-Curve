/** Builds a safe file name: ASCII letters, digits, dot, dash, underscore; at most 80 characters. */
export function safeFileName(parts: string[], extension: string): string {
  const base = parts
    .join('-')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^[-.]+|[-.]+$/g, '')
  return `${base || 'none-curve'}.${extension}`
}

/**
 * The file name the user typed, in any script: one name serves every format, so an export's extension they typed is
 * replaced by `extension`. Characters file systems refuse (and control characters) become "-", bidi controls (which
 * show a name in another order than its letters) go, and so do outer dots and spaces; at most 120 characters. An
 * empty name falls back to the generated one, `safeFileName(parts, extension)`.
 */
export function exportFileName(name: string, parts: string[], extension: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]|\p{Cc}/gu, '-')
    .replace(/\p{Bidi_Control}/gu, '')
    .replace(/[\s.]+$/, '')
    .replace(/\.(svg|png|otf|json|mp4|webm)$/i, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  const base = [...cleaned]
    .slice(0, 120)
    .join('')
    .replace(/[\s.]+$/, '')
  return base ? `${base}.${extension}` : safeFileName(parts, extension)
}

/** Starts a browser download for data the user explicitly asked to export. */
export function downloadFile(data: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser time to start the download before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
