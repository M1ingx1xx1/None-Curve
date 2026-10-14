// The Sound tab's test track (scripts/test-track.ts) is rendered rather than stored: it must be the same file on
// every run and every machine. The checksum is that of test-audio/sound-test.wav as it was committed before the
// renderer replaced it; `npm run test-track` writes the file again.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encodeWav, renderTestTrack, TEST_TRACK_SAMPLE_RATE, TEST_TRACK_SECONDS } from '../../scripts/test-track'

const SHA1 = '8b6b525c6af17402fd0d2572d54344eb9417914c'

describe('test track', () => {
  it('renders the same WAV file every time', () => {
    const track = renderTestTrack()
    const wav = encodeWav(track)
    const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')
    expect(sha1(wav)).toBe(SHA1)
    expect(sha1(encodeWav(renderTestTrack()))).toBe(SHA1)

    const frames = TEST_TRACK_SAMPLE_RATE * TEST_TRACK_SECONDS
    expect(track.sampleRate).toBe(44100)
    expect(track.left).toHaveLength(frames)
    expect(track.right).toHaveLength(frames)
    expect(wav).toHaveLength(44 + 4 * frames)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    const ascii = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4))
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([1, 2, 44100, 16])

    // The peak stays at or below -1 dBFS (0.89 of full scale).
    let peak = 0
    for (const channel of [track.left, track.right]) for (const v of channel) peak = Math.max(peak, Math.abs(v))
    expect(peak / 32768).toBeLessThanOrEqual(Math.pow(10, -1 / 20))
    expect(peak / 32768).toBeGreaterThan(0.88)
  })
})
