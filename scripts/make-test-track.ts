// Writes the Sound tab's test track (see test-track.ts) as a WAV file, by default test-audio/sound-test.wav.
// Run from the repository: npx tsx scripts/make-test-track.ts [out.wav]

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeWav, renderTestTrack } from './test-track'

const out = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../test-audio/sound-test.wav', import.meta.url))
const track = renderTestTrack()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, encodeWav(track))

let peak = 0
for (const channel of [track.left, track.right]) for (const v of channel) peak = Math.max(peak, Math.abs(v))
const frames = track.left.length
console.log(
  `${out}: ${frames} frames, ${(frames / track.sampleRate).toFixed(2)} s, peak ${peak} (${(20 * Math.log10(peak / 32767)).toFixed(2)} dBFS)`,
)
