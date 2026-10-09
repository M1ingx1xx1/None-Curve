// Google Fonts source.
//
// Previewing a font with CSS is not enough for editing: the app needs the font binary so it can read
// real outlines. The flow is therefore:
//   1. Request the official CSS2 stylesheet (fonts.googleapis.com/css2, no API key) for every
//      weight/style. The API returns only the styles that exist, plus one @font-face per subset.
//   2. Pick the face for the chosen weight, style, and subset, and download its file from
//      fonts.gstatic.com (WOFF2 in modern browsers).
//   3. Parse the bytes with the same parser as local files.
//
// The full, searchable catalog requires the Google Fonts Developer API and an API key, which cannot be
// kept secret in a static GitHub Pages build. A curated list plus free-text family names is used instead.

import { FontLoadError, isAbortError } from './errors'
import type { LoadedFont } from './model'
import { parseFont } from './parse'

export interface CuratedFamily {
  family: string
  category: 'Sans' | 'Serif' | 'Slab' | 'Mono'
}

export const curatedFamilies: CuratedFamily[] = [
  { family: 'Google Sans', category: 'Sans' },
  { family: 'Noto Sans', category: 'Sans' },
  { family: 'Archivo', category: 'Sans' },
  { family: 'Inter', category: 'Sans' },
  { family: 'DM Sans', category: 'Sans' },
  { family: 'EB Garamond', category: 'Serif' },
  { family: 'Baskervville', category: 'Serif' },
  { family: 'Bodoni Moda', category: 'Serif' },
  { family: 'DM Serif Display', category: 'Serif' },
  { family: 'Slabo 13px', category: 'Slab' },
  { family: 'Arvo', category: 'Slab' },
  { family: 'IBM Plex Mono', category: 'Mono' },
  { family: 'JetBrains Mono', category: 'Mono' },
  { family: 'Space Mono', category: 'Mono' },
  { family: 'DM Mono', category: 'Mono' },
]

export type FontStyle = 'normal' | 'italic'

export interface GoogleFace {
  subset: string
  style: FontStyle
  weight: number
  url: string
}

export interface GoogleFamilyInfo {
  family: string
  faces: GoogleFace[]
  weights: Record<FontStyle, number[]>
  subsets: string[]
  /** True when several weights are served from one file, i.e. a variable font. */
  variable: boolean
}

export interface GoogleFontRequest {
  family: string
  weight: number
  italic: boolean
  subset: string
}

const CSS2_ENDPOINT = 'https://fonts.googleapis.com/css2'
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

export function css2Url(family: string): string {
  const styles = [0, 1].flatMap((ital) => WEIGHTS.map((w) => `${ital},${w}`)).join(';')
  return `${CSS2_ENDPOINT}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${styles}`
}

const familyCache = new Map<string, GoogleFamilyInfo>()

/** Fetches and parses the CSS2 stylesheet to find which weights, styles, and subsets exist. */
export async function fetchGoogleFamily(family: string, signal: AbortSignal): Promise<GoogleFamilyInfo> {
  const name = family.trim()
  if (!name) throw new FontLoadError('api', 'Enter a font family name.')
  const cached = familyCache.get(name)
  if (cached) return cached

  const url = css2Url(name)
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw await classifyCssFailure(url, name, signal)
  }
  if (!response.ok) {
    throw new FontLoadError('api', `Google Fonts returned HTTP ${response.status} for "${name}".`)
  }

  const faces = parseFontFaces(await response.text())
  if (faces.length === 0) {
    throw new FontLoadError('api', `Google Fonts returned no font files for "${name}".`)
  }

  const info = summarize(name, faces)
  familyCache.set(name, info)
  return info
}

/**
 * Google answers unknown families with HTTP 400 but without CORS headers, so the browser reports it
 * exactly like a network failure. A no-cors request tells the two apart: it resolves (opaquely)
 * whenever the server answered at all.
 */
async function classifyCssFailure(url: string, family: string, signal: AbortSignal): Promise<FontLoadError> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new FontLoadError('network', 'You appear to be offline. Check your connection and retry.')
  }
  try {
    await fetch(url, { mode: 'no-cors', signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    return new FontLoadError(
      'network',
      'Could not reach fonts.googleapis.com. The network may be down, or a content blocker / CORS policy blocked the request.',
    )
  }
  return new FontLoadError(
    'api',
    `Google Fonts did not accept "${family}". Family names are case-sensitive and must match fonts.google.com exactly (e.g. "Open Sans").`,
  )
}

function parseFontFaces(css: string): GoogleFace[] {
  const faces: GoogleFace[] = []
  const pattern = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g
  for (const match of css.matchAll(pattern)) {
    const body = match[2]
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1])
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal'
    if (url && weight) faces.push({ subset: match[1] ?? 'default', style, weight, url: url.replace(/['"]/g, '') })
  }
  return faces
}

function summarize(family: string, faces: GoogleFace[]): GoogleFamilyInfo {
  const weightsFor = (style: FontStyle) =>
    [...new Set(faces.filter((f) => f.style === style).map((f) => f.weight))].sort((a, b) => a - b)
  const urlsPerKey = new Map<string, Set<number>>()
  for (const face of faces) {
    const key = `${face.subset}|${face.style}|${face.url}`
    urlsPerKey.set(key, (urlsPerKey.get(key) ?? new Set()).add(face.weight))
  }
  return {
    family,
    faces,
    weights: { normal: weightsFor('normal'), italic: weightsFor('italic') },
    subsets: [...new Set(faces.map((f) => f.subset))],
    variable: [...urlsPerKey.values()].some((weights) => weights.size > 1),
  }
}

export function defaultSubset(info: GoogleFamilyInfo): string {
  return info.subsets.includes('latin') ? 'latin' : info.subsets[0]
}

export function defaultWeight(weights: number[]): number {
  if (weights.includes(400)) return 400
  return weights.reduce((best, w) => (Math.abs(w - 400) < Math.abs(best - 400) ? w : best), weights[0])
}

/** Downloads the font binary for one face and parses it into the shared font model. */
export async function loadGoogleFont(request: GoogleFontRequest, signal: AbortSignal): Promise<LoadedFont> {
  const info = await fetchGoogleFamily(request.family, signal)
  const style: FontStyle = request.italic ? 'italic' : 'normal'
  const face = info.faces.find(
    (f) => f.style === style && f.weight === request.weight && f.subset === request.subset,
  )
  if (!face) {
    throw new FontLoadError(
      'api',
      `${request.family} has no ${style} ${request.weight} face in the "${request.subset}" subset.`,
    )
  }

  let response: Response
  try {
    response = await fetch(face.url, { signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new FontLoadError('download', 'Could not download the font file from fonts.gstatic.com.')
  }
  if (!response.ok) {
    throw new FontLoadError('download', `fonts.gstatic.com returned HTTP ${response.status} for the font file.`)
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new FontLoadError('download', 'The font download was interrupted.')
  }
  signal.throwIfAborted()

  return parseFont(
    bytes,
    {
      kind: 'google',
      family: request.family,
      weight: request.weight,
      italic: request.italic,
      subset: request.subset,
      version: /\/(v\d+)\//.exec(face.url)?.[1] ?? null,
      fileUrl: face.url,
      byteSize: bytes.byteLength,
    },
    signal,
  )
}
