/** Builds a safe file name: ASCII letters, digits, dot, dash, underscore; at most 80 characters. */
export function safeFileName(parts: string[], extension: string): string {
  const base = parts
    .join('-')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return `${base || 'none-curve'}.${extension}`
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
