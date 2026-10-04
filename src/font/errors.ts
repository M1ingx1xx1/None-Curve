export type FontErrorKind =
  // Local files
  | 'empty-file'
  | 'unsupported-format'
  | 'read-failed'
  // Google Fonts
  | 'network'
  | 'api'
  | 'download'
  // Both
  | 'parse'
  | 'no-glyphs'

export class FontLoadError extends Error {
  readonly kind: FontErrorKind

  constructor(kind: FontErrorKind, message: string) {
    super(message)
    this.name = 'FontLoadError'
    this.kind = kind
  }
}

export const errorKindLabel: Record<FontErrorKind, string> = {
  'empty-file': 'Empty file',
  'unsupported-format': 'Unsupported format',
  'read-failed': 'Could not read file',
  network: 'Network / CORS error',
  api: 'Google Fonts API error',
  download: 'Font download failed',
  parse: 'Font parsing failed',
  'no-glyphs': 'No usable glyphs',
}

export function toFontLoadError(error: unknown, fallback: FontErrorKind): FontLoadError {
  if (error instanceof FontLoadError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new FontLoadError(fallback, message)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
