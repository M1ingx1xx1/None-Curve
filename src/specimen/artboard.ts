// The artboard: a fixed-size image (width × height pixels) that the text is set on, with font size,
// alignment, and colours. Shared by the canvas, the preview, and SVG/PNG export, so all three
// place the text identically. No React, no DOM.

import type { SpecimenScene } from './scene'

export type TextAlign = 'left' | 'center' | 'right'
export type TextCase = 'none' | 'upper' | 'lower' | 'title'

/** Where the text block sits on the artboard: one of nine anchors (inside the margin), or Free. */
export type TextAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'
export type TextPosition = TextAnchor | 'free'

/** The nine anchors in reading order (rows top to bottom), as a 3 × 3 grid. */
/** The line alignment that goes with an anchor: its column (left, middle, right). */
export function anchorAlign(anchor: TextAnchor): TextAlign {
  return anchor.endsWith('left') ? 'left' : anchor.endsWith('right') ? 'right' : 'center'
}

export const TEXT_ANCHORS: TextAnchor[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
]

export interface TypographyParams {
  /** Font size: the em in artboard pixels. */
  size: number
  /** Extra space between glyphs, in thousandths of an em. */
  tracking: number
  /** Line spacing as a multiple of the font's own line spacing. */
  lineHeight: number
  /** Slant in degrees; positive leans right. */
  slant: number
  /** How the lines align with each other inside the text block. */
  align: TextAlign
  /** Where the text block sits on the artboard. */
  position: TextPosition
  /** Free position: the block's left and top edges as a share (0–1) of the room the artboard leaves
      beside and above the block, so the text stays inside the artboard whatever its size. */
  freeX: number
  freeY: number
  /** Shown on the canvas and exported; the typed text itself is not changed. */
  textCase: TextCase
}

export interface PaletteParams {
  /** Glyph colour, #rrggbb. */
  ink: string
  /** Background colour, #rrggbb. */
  paper: string
  /** No background: the canvas shows a checkerboard and SVG / PNG exports leave the background out.
      The background colour is kept (Swap and the preview's Invert still use it). */
  transparent: boolean
}

export interface ArtboardParams {
  /** Pixels. */
  width: number
  height: number
  /** Export multiplier: PNG files are width × scale by height × scale pixels. */
  scale: number
}

export const TYPOGRAPHY_LIMITS = {
  minSize: 4,
  maxSize: 1000,
  minTracking: -200,
  maxTracking: 1000,
  minLineHeight: 0.5,
  maxLineHeight: 3,
  maxSlant: 30,
} as const

export const ARTBOARD_LIMITS = { min: 100, max: 4000, scales: [1, 2, 3, 4] as const } as const

export const DEFAULT_TYPOGRAPHY: TypographyParams = {
  size: 48,
  tracking: 0,
  lineHeight: 1,
  slant: 0,
  align: 'left',
  position: 'left',
  freeX: 0.5,
  freeY: 0.5,
  textCase: 'none',
}

/** Space the anchors and Fit text keep between the text and every canvas edge, in canvas pixels. */
export const EDGE_MARGIN_PX = 25

export const DEFAULT_ARTBOARD: ArtboardParams = { width: 1200, height: 800, scale: 1 }

/** Named colour pairs. The first is the default. */
export const PALETTES: { name: string; ink: string; paper: string }[] = [
  { name: 'Charcoal', ink: '#101010', paper: '#fffdfa' },
  { name: 'Off White', ink: '#fdfdef', paper: '#050505' },
  { name: 'Kryptonite', ink: '#66ffe5', paper: '#001911' },
  { name: 'Plum', ink: '#f800e3', paper: '#23060a' },
  { name: 'Glowing Cyan', ink: '#35d7ff', paper: '#001d38' },
  { name: 'Acid Lime', ink: '#c8ff00', paper: '#141900' },
  { name: 'Ember', ink: '#ff7a1a', paper: '#1a0b05' },
  { name: 'Moonlit Purple', ink: '#dfb1ed', paper: '#0d0e1c' },
  { name: 'Chrome Pink', ink: '#fe019a', paper: '#c1c7cd' },
  { name: 'Cherry', ink: '#f3385d', paper: '#ffe0e9' },
  { name: 'Atomic Blue', ink: '#0000d6', paper: '#d6ddf0' },
  { name: 'Forest Moss', ink: '#006100', paper: '#d1ffd1' },
]

export const DEFAULT_PALETTE: PaletteParams = { ink: PALETTES[0].ink, paper: PALETTES[0].paper, transparent: false }

/** Applies the case setting for display and export; the typed text is left as it is. */
export function applyTextCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case 'upper':
      return text.toUpperCase()
    case 'lower':
      return text.toLowerCase()
    case 'title':
      // First letter of every word upper case, the rest lower case. Apostrophes stay inside words.
      return text.replace(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu, (word) => {
        const [first, ...rest] = [...word]
        return first.toUpperCase() + rest.join('').toLowerCase()
      })
    default:
      return text
  }
}

/** Where the artboard sits in scene coordinates (font units, y down, first baseline at 0). */
export interface ArtboardLayout {
  /** Font units per artboard pixel. */
  unitsPerPx: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * The box the text is placed by: where its outlines are (slant included), so at an anchor the letters
 * themselves sit the margin away from the canvas edges. Without outlines (only spaces), the lines' box.
 */
export function textBox(scene: SpecimenScene) {
  if (scene.ink) {
    const { minX, minY, maxX, maxY } = scene.ink
    return { minX, minY, width: maxX - minX, height: maxY - minY }
  }
  return { minX: 0, minY: scene.textTop, width: scene.blockWidth, height: scene.textBottom - scene.textTop }
}

/**
 * Places the text block on the artboard. The em is `size` pixels, which fixes the scale between font
 * units and pixels. At an anchor the outlines' box sits against the left margin, in the middle, or
 * against the right margin, and against the top margin, in the middle, or against the bottom margin
 * (EDGE_MARGIN_PX from the canvas edges, whatever the font size); the lines are already aligned inside
 * the block by the scene. Free places the box by freeX / freeY, inside the artboard edges.
 */
export function layoutArtboard(scene: SpecimenScene, typography: TypographyParams, artboard: ArtboardParams, unitsPerEm: number): ArtboardLayout {
  const emPx = clamp(typography.size, TYPOGRAPHY_LIMITS.minSize, TYPOGRAPHY_LIMITS.maxSize)
  const unitsPerPx = unitsPerEm / emPx
  const width = artboard.width * unitsPerPx
  const height = artboard.height * unitsPerPx
  const pad = EDGE_MARGIN_PX * unitsPerPx
  const { position } = typography
  const box = textBox(scene)
  if (position === 'free') {
    const x = box.minX - clamp(typography.freeX, 0, 1) * (width - box.width)
    const y = box.minY - clamp(typography.freeY, 0, 1) * (height - box.height)
    return { unitsPerPx, x, y, width, height }
  }
  const column = position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center'
  const row = position.startsWith('top') ? 'top' : position.startsWith('bottom') ? 'bottom' : 'middle'
  const x =
    column === 'left'
      ? box.minX - pad
      : column === 'right'
        ? box.minX + box.width + pad - width
        : box.minX + box.width / 2 - width / 2
  const y =
    row === 'top'
      ? box.minY - pad
      : row === 'bottom'
        ? box.minY + box.height + pad - height
        : box.minY + box.height / 2 - height / 2
  return { unitsPerPx, x, y, width, height }
}

/** freeX / freeY that keep the block where it is now, for switching from an anchor to Free. */
export function freeFromLayout(scene: SpecimenScene, layout: ArtboardLayout): Pick<TypographyParams, 'freeX' | 'freeY'> {
  const box = textBox(scene)
  const roomX = layout.width - box.width
  const roomY = layout.height - box.height
  return {
    freeX: roomX > 0 ? round3(clamp((box.minX - layout.x) / roomX, 0, 1)) : 0.5,
    freeY: roomY > 0 ? round3(clamp((box.minY - layout.y) / roomY, 0, 1)) : 0.5,
  }
}

/**
 * Free position after dragging the text by (dx, dy) font units from where it was at `start`. The block
 * stops at the artboard edges; along an axis where it is larger than the artboard it does not move.
 */
export function moveFreeText(
  start: Pick<TypographyParams, 'freeX' | 'freeY'>,
  dx: number,
  dy: number,
  scene: SpecimenScene,
  layout: ArtboardLayout,
): Pick<TypographyParams, 'freeX' | 'freeY'> {
  const box = textBox(scene)
  const roomX = layout.width - box.width
  const roomY = layout.height - box.height
  return {
    freeX: roomX > 0 ? round3(clamp(start.freeX + dx / roomX, 0, 1)) : start.freeX,
    freeY: roomY > 0 ? round3(clamp(start.freeY + dy / roomY, 0, 1)) : start.freeY,
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * The font size (pixels per em) at which the outlines, slant included, fit inside the margin on both
 * axes: the text fills the artboard less EDGE_MARGIN_PX on each side. Rounded down to a whole pixel so
 * it never overflows.
 */
export function fitTextSize(scene: SpecimenScene, typography: TypographyParams, artboard: ArtboardParams, unitsPerEm: number): number {
  const box = textBox(scene)
  if (!(box.width > 0 && box.height > 0)) return typography.size
  const room = (side: number) => Math.max(1, side - 2 * EDGE_MARGIN_PX)
  const emPx = Math.min((room(artboard.width) * unitsPerEm) / box.width, (room(artboard.height) * unitsPerEm) / box.height)
  return clamp(Math.floor(emPx), TYPOGRAPHY_LIMITS.minSize, TYPOGRAPHY_LIMITS.maxSize)
}

/** What zoom 1 shows: the artboard with a small margin, in font units with y up (for usePanZoom). */
export function artboardViewFrame(layout: ArtboardLayout) {
  const margin = 1.06
  return {
    cx: layout.x + layout.width / 2,
    cy: -(layout.y + layout.height / 2),
    width: layout.width * margin,
    height: layout.height * margin,
  }
}

/** #rgb or #rrggbb (with or without #) → #rrggbb in lower case, or null. */
export function normalizeHex(value: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${hex.toLowerCase()}`
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function clamp(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min
}
