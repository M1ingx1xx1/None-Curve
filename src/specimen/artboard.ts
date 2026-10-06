// The artboard: a fixed-size image (width × height pixels) that the text is set on, with font size,
// padding, alignment, and colours. Shared by the canvas, the preview, and SVG/PNG export, so all three
// place the text identically. No React, no DOM.

import type { SpecimenScene } from './scene'

export type TextAlign = 'left' | 'center' | 'right'
export type TextCase = 'none' | 'upper' | 'lower' | 'title'

/** Where the text block sits on the artboard: one of nine anchors (inside the padding), or Free. */
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
  /** Font size as a percentage of the artboard width (the em in pixels = size % × width). */
  size: number
  /** Space kept free on every side, as a percentage of the artboard width. */
  padding: number
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
  minSize: 0.5,
  maxSize: 40,
  maxPadding: 30,
  minTracking: -200,
  maxTracking: 1000,
  minLineHeight: 0.5,
  maxLineHeight: 3,
  maxSlant: 30,
} as const

export const ARTBOARD_LIMITS = { min: 100, max: 4000, scales: [1, 2, 3, 4] as const } as const

export const DEFAULT_TYPOGRAPHY: TypographyParams = {
  size: 4,
  padding: 8,
  tracking: 0,
  lineHeight: 1,
  slant: 0,
  align: 'left',
  position: 'left',
  freeX: 0.5,
  freeY: 0.5,
  textCase: 'none',
}

export const DEFAULT_ARTBOARD: ArtboardParams = { width: 1200, height: 800, scale: 1 }

/** Named colour pairs. The first is the default. */
export const PALETTES: { name: string; ink: string; paper: string }[] = [
  { name: 'Charcoal', ink: '#101010', paper: '#f7f3ea' },
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

/** The text block for Free positioning: the lines' box joined with the outlines (slant included). */
function freeBox(scene: SpecimenScene) {
  const minX = Math.min(0, scene.bounds.minX)
  const maxX = Math.max(scene.blockWidth, scene.bounds.maxX)
  const minY = Math.min(scene.textTop, scene.bounds.minY)
  const maxY = Math.max(scene.textBottom, scene.bounds.maxY)
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Places the text block on the artboard. The em is size % of the artboard width, which fixes the
 * scale between font units and pixels. At an anchor the block sits at the left padding, in the
 * middle, or at the right padding, and at the top padding, in the middle (between the first line's
 * ascender and the last line's descender), or at the bottom padding; the lines are already aligned
 * inside the block by the scene. Free places the block by freeX / freeY, inside the artboard edges.
 */
export function layoutArtboard(scene: SpecimenScene, typography: TypographyParams, artboard: ArtboardParams, unitsPerEm: number): ArtboardLayout {
  const emPx = Math.max(0.01, (clamp(typography.size, TYPOGRAPHY_LIMITS.minSize, TYPOGRAPHY_LIMITS.maxSize) / 100) * artboard.width)
  const unitsPerPx = unitsPerEm / emPx
  const width = artboard.width * unitsPerPx
  const height = artboard.height * unitsPerPx
  const pad = (clamp(typography.padding, 0, TYPOGRAPHY_LIMITS.maxPadding) / 100) * artboard.width * unitsPerPx
  const { position } = typography
  if (position === 'free') {
    const box = freeBox(scene)
    const x = box.minX - clamp(typography.freeX, 0, 1) * (width - box.width)
    const y = box.minY - clamp(typography.freeY, 0, 1) * (height - box.height)
    return { unitsPerPx, x, y, width, height }
  }
  const block = scene.blockWidth
  const column = position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center'
  const row = position.startsWith('top') ? 'top' : position.startsWith('bottom') ? 'bottom' : 'middle'
  const x = column === 'left' ? -pad : column === 'center' ? block / 2 - width / 2 : block + pad - width
  const y =
    row === 'top'
      ? scene.textTop - pad
      : row === 'bottom'
        ? scene.textBottom + pad - height
        : (scene.textTop + scene.textBottom) / 2 - height / 2
  return { unitsPerPx, x, y, width, height }
}

/** freeX / freeY that keep the block where it is now, for switching from an anchor to Free. */
export function freeFromLayout(scene: SpecimenScene, layout: ArtboardLayout): Pick<TypographyParams, 'freeX' | 'freeY'> {
  const box = freeBox(scene)
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
  const box = freeBox(scene)
  const roomX = layout.width - box.width
  const roomY = layout.height - box.height
  return {
    freeX: roomX > 0 ? round3(clamp(start.freeX + dx / roomX, 0, 1)) : start.freeX,
    freeY: roomY > 0 ? round3(clamp(start.freeY + dy / roomY, 0, 1)) : start.freeY,
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * The font size (% of the artboard width) at which the whole text block, slant included, fits inside
 * the padding on both axes. Rounded down to 0.1 so it never overflows.
 */
export function fitTextSize(scene: SpecimenScene, typography: TypographyParams, artboard: ArtboardParams, unitsPerEm: number): number {
  const pad = (clamp(typography.padding, 0, TYPOGRAPHY_LIMITS.maxPadding) / 100) * artboard.width
  const availableWidth = artboard.width - 2 * pad
  const availableHeight = artboard.height - 2 * pad
  const blockWidth = (scene.bounds.maxX - scene.bounds.minX) / unitsPerEm
  const blockHeight = (Math.max(scene.bounds.maxY, scene.textBottom) - Math.min(scene.bounds.minY, scene.textTop)) / unitsPerEm
  if (!(blockWidth > 0 && blockHeight > 0) || availableWidth <= 0 || availableHeight <= 0) return typography.size
  const emPx = Math.min(availableWidth / blockWidth, availableHeight / blockHeight)
  const size = Math.floor(((emPx / artboard.width) * 100) * 10) / 10
  return clamp(size, TYPOGRAPHY_LIMITS.minSize, TYPOGRAPHY_LIMITS.maxSize)
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
