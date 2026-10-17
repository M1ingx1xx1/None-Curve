import { FontLoadError } from './errors'
import type { LoadedFont } from './model'
import { parseFont } from './parse'

export const LOCAL_FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'

const MAX_BYTES = 50 * 1024 * 1024

/** Reads a user-selected file entirely in the browser. Nothing is uploaded. */
export async function loadLocalFont(file: File, signal: AbortSignal): Promise<LoadedFont> {
  if (file.size === 0) throw new FontLoadError('empty-file', `"${file.name}" is empty (0 bytes).`)
  if (file.size > MAX_BYTES) {
    throw new FontLoadError('read-failed', `"${file.name}" is larger than 50 MB.`)
  }

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new FontLoadError('read-failed', `The browser could not read "${file.name}".`)
  }
  signal.throwIfAborted()

  return parseFont(new Uint8Array(buffer), { kind: 'local', fileName: file.name, byteSize: file.size }, signal)
}
