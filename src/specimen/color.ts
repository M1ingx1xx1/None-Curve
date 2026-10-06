import { contrastRatio } from './artboard'

/** OKLab: a perceptual colour space, so "lighter by 0.2" looks about equally lighter for every hue. */
interface Lab {
  L: number
  a: number
  b: number
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

function hexToLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** Linear sRGB of an OKLab colour; components outside 0–1 mean the colour is out of gamut. */
function labToLinear({ L, a, b }: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** The colour as #rrggbb; out-of-gamut colours keep their lightness and hue and lose chroma until they fit. */
function labToHex(lab: Lab): string {
  let { a, b } = lab
  for (let i = 0; i < 24 && !inGamut(labToLinear({ L: lab.L, a, b })); i++) {
    a *= 0.9
    b *= 0.9
  }
  return `#${labToLinear({ L: lab.L, a, b })
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

const chroma = ({ a, b }: Lab) => Math.hypot(a, b)
const hue = ({ a, b }: Lab) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
const hueGap = (x: number, y: number) => Math.abs((((x - y) % 360) + 540) % 360 - 180)
const fromLch = (L: number, C: number, h: number): Lab => ({
  L,
  a: C * Math.cos((h * Math.PI) / 180),
  b: C * Math.sin((h * Math.PI) / 180),
})

/** The most saturated in-gamut chroma at this lightness and hue. */
function maxChroma(L: number, h: number): number {
  let low = 0
  let high = 0.4
  for (let i = 0; i < 14; i++) {
    const mid = (low + high) / 2
    if (inGamut(labToLinear(fromLch(L, mid, h)))) low = mid
    else high = mid
  }
  return low
}

/** Hues tried on each side of the palette's own hue, so the highlight stays in the same colour family;
    the wider range is used only when the narrow one cannot differ enough (an already vivid text). */
const HUE_RANGES = [40, 90]
/** OKLab colour (a, b) difference below which the highlight would not stand out from the text. */
const MIN_COLOUR_DISTANCE = 0.15
/** A colour with less chroma than this has no meaningful hue (greys, near-black, near-white). */
const NEUTRAL = 0.012
/** Hue used when both colours are neutral: a warm orange, which stands out on both black and white. */
const FALLBACK_HUE = 55

const cache = new Map<string, string>()

/**
 * The highlight colour for selected and hovered glyphs, computed from the text and background
 * colours. Among colours that stay readable on the background (at least the text's own contrast, up
 * to 4.5 : 1, and never below 3 : 1), it picks the one that differs most from the text colour in
 * hue and chroma (OKLab) without fading toward the background, preferring vivid colours and staying
 * within 40° of the palette's hue (90° when that is not enough to stand out): the text's
 * hue when it has one, otherwise the background's, otherwise a warm orange. So black text on cream
 * paper highlights in vermilion (like a red pen mark in print), amber on brown in vermilion, and a
 * coloured text in a vivid, neighbouring hue of its own colour.
 */
export function highlightColor(ink: string, paper: string): string {
  const key = `${ink}${paper}`
  const cached = cache.get(key)
  if (cached) return cached
  const inkLab = hexToLab(ink)
  const paperLab = hexToLab(paper)
  const baseHue =
    chroma(inkLab) >= NEUTRAL ? hue(inkLab) : chroma(paperLab) >= NEUTRAL ? hue(paperLab) : FALLBACK_HUE
  const minContrast = Math.max(3, Math.min(4.5, contrastRatio(ink, paper)))
  // Moving lightness toward the background makes the highlight dimmer than the text, not stronger.
  const towardPaper = Math.sign(paperLab.L - inkLab.L)

  let best = { score: -Infinity, hex: ink, distance: 0 }
  for (const range of HUE_RANGES) {
    best = { score: -Infinity, hex: ink, distance: 0 }
    for (let dh = -range; dh <= range; dh += 5) {
      const h = (baseHue + dh + 360) % 360
      for (let L = 0.2; L <= 0.97; L += 0.02) {
        const C = maxChroma(L, h) * 0.92
        const lab = fromLch(L, C, h)
        const hex = labToHex(lab)
        if (contrastRatio(hex, paper) < minContrast) continue
        // Stand out by colour (hue and chroma) rather than by fading; vivid reads as highlighted, and
        // staying near the palette's hue keeps it in harmony.
        const colourDistance = Math.hypot(lab.a - inkLab.a, lab.b - inkLab.b)
        const fading = Math.max(0, (L - inkLab.L) * towardPaper)
        const score = colourDistance + C - 0.2 * fading - 0.06 * (hueGap(h, baseHue) / range)
        if (score > best.score) best = { score, hex, distance: colourDistance }
      }
    }
    if (best.distance >= MIN_COLOUR_DISTANCE) break
  }
  cache.set(key, best.hex)
  return best.hex
}
