// The interface colours the canvas renderers draw with (skeleton, original curves, vertices, missing boxes), resolved
// from the stylesheet's tokens. The tokens are light-dark() values, which only the browser can resolve: a hidden probe
// element inside the view takes each token as its colour and getComputedStyle reads it back as rgb(). The result is
// cached until the theme changes (the page's data-theme attribute, or the system's light or dark preference).

import type { RenderColors } from './types'

/** The tokens read from the stylesheet, by RenderColors field. Ink and highlight come from the palette instead. */
const THEME_TOKENS = {
  accent: '--accent',
  control: '--control',
  vertex: '--vertex',
  danger: '--danger',
  canvas: '--canvas',
} as const

export type ThemeTokens = Omit<RenderColors, 'ink' | 'highlight'>

/** Fallbacks for a token the browser could not resolve (the light theme's values). */
const FALLBACK: ThemeTokens = {
  accent: 'rgb(31, 79, 209)',
  control: 'rgb(194, 65, 12)',
  vertex: 'rgb(15, 138, 95)',
  danger: 'rgb(180, 35, 24)',
  canvas: 'rgb(251, 251, 250)',
}

/** Resolves one CSS colour expression (such as `var(--accent)`) to the colour the browser computes for it. */
export type ColorReader = (expression: string) => string

/** Every token through `read`; a token that comes back empty or unparsable keeps its fallback. */
export function resolveTokens(read: ColorReader): ThemeTokens {
  const colors = { ...FALLBACK }
  for (const key of Object.keys(THEME_TOKENS) as (keyof ThemeTokens)[]) {
    let value: string
    try {
      value = read(`var(${THEME_TOKENS[key]})`).trim()
    } catch {
      value = ''
    }
    if (parseColor(value)) colors[key] = value
  }
  return colors
}

/**
 * A reader that resolves through a hidden span inside `container` (so the container's own tokens apply). The span is
 * made for the read and removed again.
 */
export function probeReader(
  container: HTMLElement,
  computed: (el: Element) => { color: string } = getComputedStyle,
): ColorReader {
  return (expression) => {
    const span = container.ownerDocument.createElement('span')
    span.style.display = 'none'
    span.style.color = expression
    container.appendChild(span)
    try {
      return computed(span).color
    } finally {
      span.remove()
    }
  }
}

/** Where the theme can change: the root's attributes and the system colour scheme. Injected for tests. */
export interface ThemeEnvironment {
  /** Calls `listener` when an attribute of the document's root element changes; returns a stop. */
  observeRoot(listener: () => void): () => void
  /** Calls `listener` when the system switches between light and dark; returns a stop. */
  observeScheme(listener: () => void): () => void
}

function browserEnvironment(): ThemeEnvironment {
  return {
    observeRoot(listener) {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
      const observer = new MutationObserver(listener)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class', 'style'],
      })
      return () => observer.disconnect()
    },
    observeScheme(listener) {
      if (typeof matchMedia === 'undefined') return () => {}
      const query = matchMedia('(prefers-color-scheme: dark)')
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
  }
}

/**
 * The resolved tokens for one view, cached until the theme changes. `subscribe` tells a renderer to take the new colours
 * (and draw again).
 */
export class ThemeColors {
  private cached: ThemeTokens | null = null
  private listeners = new Set<() => void>()
  private stops: (() => void)[] = []

  constructor(
    private readonly read: ColorReader,
    environment: ThemeEnvironment = browserEnvironment(),
  ) {
    const changed = () => {
      this.cached = null
      for (const listener of this.listeners) listener()
    }
    this.stops.push(environment.observeRoot(changed), environment.observeScheme(changed))
  }

  get(): ThemeTokens {
    if (!this.cached) this.cached = resolveTokens(this.read)
    return this.cached
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    for (const stop of this.stops) stop()
    this.stops = []
    this.listeners.clear()
  }
}

/** A colour as straight (not premultiplied) RGBA, each 0–1. */
export type Rgba = [number, number, number, number]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** One channel of rgb(): a number 0–255 or a percentage. */
function channel(text: string): number {
  return text.endsWith('%') ? clamp01(parseFloat(text) / 100) : clamp01(parseFloat(text) / 255)
}

/** An alpha value: 0–1 or a percentage. */
function alpha(text: string | undefined): number {
  if (text === undefined) return 1
  return text.endsWith('%') ? clamp01(parseFloat(text) / 100) : clamp01(parseFloat(text))
}

/**
 * Parses the colour forms a computed style or the palette gives: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with
 * commas or spaces (and a / alpha), and color(srgb r g b / a). Null for anything else (the WebGL renderer needs numbers).
 */
export function parseColor(text: string): Rgba | null {
  const value = text.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)
  if (hex) {
    let digits = hex[1]
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join('')
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255
    return [n(0), n(2), n(4), digits.length === 8 ? n(6) : 1]
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(value)
  if (rgb) {
    const [main, slash] = rgb[1].split('/')
    const parts = main.split(/[\s,]+/).filter(Boolean)
    if (parts.length < 3 || parts.slice(0, 3).some((p) => Number.isNaN(parseFloat(p)))) return null
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha(slash?.trim() ?? parts[3])]
  }
  const srgb = /^color\(srgb\s+([^)]*)\)$/.exec(value)
  if (srgb) {
    const [main, slash] = srgb[1].split('/')
    const parts = main.split(/\s+/).filter(Boolean)
    if (parts.length < 3 || parts.slice(0, 3).some((p) => Number.isNaN(parseFloat(p)))) return null
    const unit = (p: string) => (p.endsWith('%') ? clamp01(parseFloat(p) / 100) : clamp01(parseFloat(p)))
    return [unit(parts[0]), unit(parts[1]), unit(parts[2]), alpha(slash?.trim())]
  }
  if (value === 'transparent') return [0, 0, 0, 0]
  return null
}
