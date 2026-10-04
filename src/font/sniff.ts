import { FontLoadError } from './errors'
import type { FontFormat } from './model'

/** Detects the font container from its first four bytes rather than trusting the file extension. */
export function sniffFontFormat(bytes: Uint8Array): FontFormat {
  if (bytes.byteLength === 0) throw new FontLoadError('empty-file', 'The file is empty (0 bytes).')
  if (bytes.byteLength < 12) {
    throw new FontLoadError('unsupported-format', 'The file is too small to be a font.')
  }
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  const isTrueTypeVersion = bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00
  if (isTrueTypeVersion || tag === 'true') return 'ttf'
  if (tag === 'OTTO') return 'otf'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'ttcf') {
    throw new FontLoadError(
      'unsupported-format',
      'Font collections (.ttc / .otc) are not supported yet. Import a single .ttf, .otf, .woff, or .woff2 file.',
    )
  }
  throw new FontLoadError(
    'unsupported-format',
    'This is not a recognized font file. Supported formats: .ttf, .otf, .woff, .woff2.',
  )
}
