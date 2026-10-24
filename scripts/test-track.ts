// The Sound tab's test track, rendered in memory: 42 s, 16-bit stereo, 44.1 kHz, one section per reading. Pure and
// dependency-free: make-test-track.ts writes it to test-audio/sound-test.wav, and tests can render it without a file.
//
// 0–26 s, the same in both channels, normalised to a peak of 0.89:
//   0–4 s        kick only (Bass, Beat);
//   4–8 s        kick and hi-hats at 8/s (Treble, Brightness, Beat);
//   8–12 s       kick and a rising mid chord (Mids, Level rising);
//   12–15.5 s    silence (the letters return to the sliders; "No sound detected." after 3 s);
//   15.5–21.5 s  full mix, loud then fading (Level swings);
//   21.5–26 s    hi-hats only, bright and fast (16/s, no kick).
// 26–42 s, at fixed levels:
//   26–32 s      a single-note melody, one note every 0.5 s, A2 A3 A4 A5 A4 A3 and again (Pitch), centred;
//   32–38 s      hi-hats at 8/s, four hard left, four hard right and so on, over a quiet A1 bass in the centre (Pan).
//                Pan is smoothed with the release time (150 ms by default): hats switching side one by one would read
//                only about ±0.1 to ±0.2, so they switch every half second and ring for 40 ms, and read about ±0.5;
//   38–42 s      unrelated noise in left and right, fading out (wide; Pan stays centred).
// Every sound from 26 s fades in and out over a few ms (no clicks); the peak stays at or below −1 dBFS.

export const TEST_TRACK_SAMPLE_RATE = 44100
export const TEST_TRACK_SECONDS = 42

export interface TestTrack {
  sampleRate: number
  /** 16-bit samples as written to the file; divide by 32768 for −1…1. */
  left: Int16Array
  right: Int16Array
}

/** Renders the whole track. Deterministic: the same samples on every call. */
export function renderTestTrack(): TestTrack {
  const sr = TEST_TRACK_SAMPLE_RATE
  const centre = renderCentre(sr)
  const [stereoLeft, stereoRight] = renderStereo(sr)
  const left = new Int16Array(centre.length + stereoLeft.length)
  const right = new Int16Array(left.length)
  left.set(centre)
  right.set(centre)
  left.set(stereoLeft, centre.length)
  right.set(stereoRight, centre.length)
  return { sampleRate: sr, left, right }
}

/** The track as a WAV file: PCM, 16-bit, stereo. */
export function encodeWav(track: TestTrack): Uint8Array {
  const frames = track.left.length
  const dataBytes = frames * 4
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // channels
  view.setUint32(24, track.sampleRate, true)
  view.setUint32(28, track.sampleRate * 4, true) // bytes a second
  view.setUint16(32, 4, true) // bytes a frame
  view.setUint16(34, 16, true) // bits a sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + 4 * i, track.left[i], true)
    view.setInt16(46 + 4 * i, track.right[i], true)
  }
  return bytes
}

/** 0–26 s: one channel, normalised to a peak of 0.89. */
function renderCentre(sr: number): Int16Array {
  const n = Math.trunc(sr * 26)
  const out = new Float64Array(n)
  const random = pythonRandom(7)
  const add = (i: number, v: number) => {
    if (i >= 0 && i < n) out[i] += v
  }
  const kick = (t0: number, gain = 0.9) => {
    // Long enough to decay to about 0: no click where it stops.
    for (let k = 0; k < Math.trunc(0.45 * sr); k++) {
      const t = k / sr
      const f = 58 - 14 * Math.min(1, t / 0.1)
      add(t0 + k, gain * Math.exp(-t / 0.06) * Math.sin(2 * Math.PI * f * t))
    }
  }
  const hat = (t0: number, gain = 0.22) => {
    let last = 0
    for (let k = 0; k < Math.trunc(0.08 * sr); k++) {
      const x = random.uniform(-1, 1)
      add(t0 + k, gain * Math.exp(-(k / sr) / 0.015) * (x - last))
      last = x
    }
  }
  // A sustained chord whose gain ramps from g0 to g1, with 50 ms fades.
  const pad = (a: number, b: number, freqs: number[], g0: number, g1: number) => {
    for (let i = Math.trunc(a * sr); i < Math.trunc(b * sr); i++) {
      const t = i / sr
      const u = (t - a) / (b - a)
      const env = (g0 + (g1 - g0) * u) * Math.min(1, (t - a) / 0.05, (b - t) / 0.05)
      let sum = 0
      for (const f of freqs) sum += Math.sin(2 * Math.PI * f * t)
      add(i, (env * sum) / freqs.length)
    }
  }

  const beat = 0.5 // 120 BPM
  // 0–4 s: kick only.
  for (let b = 0; b < 8; b++) kick(Math.trunc(b * beat * sr))
  // 4–8 s: kick and hi-hats at 8/s.
  for (let b = 8; b < 16; b++) kick(Math.trunc(b * beat * sr))
  for (let h = 32; h < 64; h++) hat(Math.trunc((h / 8) * sr))
  // 8–12 s: kick and a rising mid chord.
  for (let b = 16; b < 24; b++) kick(Math.trunc(b * beat * sr), 0.7)
  pad(8, 12, [220, 277.2, 329.6, 440], 0.05, 0.35)
  // 12–15.5 s: silence. 15.5–21.5 s: full mix, loud then fading.
  for (let b = 31; b < 43; b++) kick(Math.trunc(b * beat * sr), 0.9 - 0.06 * (b - 31))
  for (let h = 124; h < 172; h++) hat(Math.trunc((h / 8) * sr), 0.25 - 0.003 * (h - 124))
  pad(15.5, 21.5, [110, 164.8, 220], 0.4, 0.05)
  // 21.5–26 s: hi-hats only, 16/s.
  for (let h = 344; h < 414; h++) hat(Math.trunc((h / 16) * sr), 0.2)

  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  return toPcm(out, (v) => (v / peak) * 0.89)
}

/** 26–42 s: left and right, at fixed levels. */
function renderStereo(sr: number): [Int16Array, Int16Array] {
  const start = 26
  const m = Math.trunc(sr * TEST_TRACK_SECONDS) - Math.trunc(sr * start)
  const left = new Float64Array(m)
  const right = new Float64Array(m)
  const random = pythonRandom(26)
  const put = (channel: Float64Array, t: number, v: number) => {
    const i = roundHalfEven((t - start) * sr)
    if (i >= 0 && i < m) channel[i] += v
  }
  // 0 → 1 over `ms` after a, 1 → 0 over `ms` before b.
  const fade = (t: number, a: number, b: number, ms: number) =>
    Math.max(0, Math.min(1, (t - a) / (ms / 1000), (b - t) / (ms / 1000)))

  // 26–32 s: melody, A2 A3 A4 A5 A4 A3, twice; 5 harmonics at 1/h (a band-limited, mellow sawtooth).
  const notes = [110, 220, 440, 880, 440, 220, 110, 220, 440, 880, 440, 220]
  notes.forEach((f, j) => {
    const a = start + 0.5 * j
    const b = a + 0.5
    for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) {
      const t = i / sr
      const u = t - a
      let v = 0
      for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * u) / h
      v *= 0.25 * fade(t, a, b, 8)
      put(left, t, v)
      put(right, t, v)
    }
  })

  // 32–38 s: hats at 8/s, four hard left, four hard right and so on, over a quiet A1 bass in the centre.
  const hat = (channel: Float64Array, t0: number, gain = 0.22) => {
    let last = 0
    for (let k = 0; k < Math.trunc(0.12 * sr); k++) {
      const x = random.uniform(-1, 1)
      const env = Math.exp(-(k / sr) / 0.04) * Math.min(1, (0.12 * sr - k) / (0.005 * sr)) // 5 ms tail fade
      put(channel, t0 + k / sr, gain * env * (x - last))
      last = x
    }
  }
  for (let h = 0; h < 48; h++) hat(Math.trunc(h / 4) % 2 === 0 ? left : right, 32 + h / 8)
  for (let i = Math.trunc(32 * sr); i < Math.trunc(38 * sr); i++) {
    const t = i / sr
    const v = 0.02 * fade(t, 32, 38, 20) * (Math.sin(2 * Math.PI * 55 * t) + 0.3 * Math.sin(2 * Math.PI * 110 * t))
    put(left, t, v)
    put(right, t, v)
  }

  // 38–42 s: unrelated white noise in each channel, fading out linearly from 0.3.
  for (let i = Math.trunc(38 * sr); i < Math.trunc(42 * sr); i++) {
    const t = i / sr
    const g = ((0.3 * (42 - t)) / 4) * fade(t, 38, 42, 10)
    put(left, t, g * random.uniform(-1, 1))
    put(right, t, g * random.uniform(-1, 1))
  }

  const limit = Math.round(10 ** (-1 / 20) * 32767)
  const pcm: [Int16Array, Int16Array] = [toPcm(left), toPcm(right)]
  for (const channel of pcm) {
    for (const v of channel)
      if (Math.abs(v) > limit) throw new Error(`Test track: peak ${Math.abs(v)} above -1 dBFS (${limit})`)
  }
  return pcm
}

function toPcm(samples: Float64Array, scale: (v: number) => number = (v) => v): Int16Array {
  return Int16Array.from(samples, (v) => Math.round(scale(v) * 32767))
}

/** Rounds halves to even, as Python's round() does: the hats on odd eighths of a second start on a half sample. */
function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/**
 * `uniform(a, b)` of Python's random.Random(seed) for an integer seed: MT19937, seeded with init_by_array. The
 * track was first made by a Python script; with the same noise its readings, and the notes about them, still hold.
 */
function pythonRandom(seed: number): { uniform(a: number, b: number): number } {
  const N = 624
  const M = 397
  const mt = new Uint32Array(N)
  mt[0] = 19650218
  for (let i = 1; i < N; i++) mt[i] = Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i
  let i = 1
  for (let k = N; k > 0; k--) {
    mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + seed
    if (++i >= N) {
      mt[0] = mt[N - 1]
      i = 1
    }
  }
  for (let k = N - 1; k > 0; k--) {
    mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i
    if (++i >= N) {
      mt[0] = mt[N - 1]
      i = 1
    }
  }
  mt[0] = 0x80000000
  let index = N

  const next = () => {
    if (index >= N) {
      for (let k = 0; k < N; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % N] & 0x7fffffff)
        mt[k] = mt[(k + M) % N] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)
      }
      index = 0
    }
    let y = mt[index++]
    y ^= y >>> 11
    y ^= (y << 7) & 0x9d2c5680
    y ^= (y << 15) & 0xefc60000
    y ^= y >>> 18
    return y >>> 0
  }
  // 53 random bits, as Python's random() takes them.
  const random = () => ((next() >>> 5) * 67108864 + (next() >>> 6)) / 9007199254740992
  return { uniform: (a, b) => a + (b - a) * random() }
}
