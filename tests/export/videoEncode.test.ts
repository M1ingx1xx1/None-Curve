// The video's sound (src/export/videoEncode.ts audioSlice): a file the browser cannot decode gives no sound (the
// video is rendered without it, audioDropped) rather than failing the render.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { audioSlice } from '../../src/export/videoEncode'

describe('the video’s sound', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is null when the file cannot be decoded', async () => {
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        decodeAudioData() {
          return Promise.reject(new DOMException('Unable to decode audio data', 'EncodingError'))
        }
      },
    )
    expect(await audioSlice(new Blob([new Uint8Array(4)]), { startMs: 0, endMs: 1000 })).toBeNull()
  })
})
