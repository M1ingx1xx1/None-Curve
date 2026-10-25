// Google Fonts source.
//
// Previewing a font with CSS is not enough for editing: the app needs the font binary so it can read
// real outlines. The flow is therefore:
//   1. Request the official CSS2 stylesheet (fonts.googleapis.com/css2, no API key) for every
//      weight/style. The API returns only the styles that exist, plus one @font-face per subset.
//   2. Pick the face for the chosen weight, style, and subset, and download its file from
//      fonts.gstatic.com (WOFF2 in modern browsers). A variable family serves one file for every
//      weight; asked for a single weight, Google serves a static file made for that weight instead,
//      so the chosen weight is requested on its own.
//   3. Parse the bytes with the same parser as local files (which applies the weight itself if the
//      file is still variable).
//
// The full, searchable catalog requires the Google Fonts Developer API and an API key, which cannot be
// kept secret in a static GitHub Pages build. A curated list plus free-text family names is used instead.

import { FontLoadError, isAbortError } from './errors'
import type { LoadedFont } from './model'
import { parseFont } from './parse'
import { bundleSubsets } from './subsets'

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
  /** True when several weights are served from one file, i.e. a variable font. Every weight can still be loaded. */
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

/** CSS2 URL for these styles of a family (every weight, upright and italic, by default). */
function css2Url(family: string, styles = [0, 1].flatMap((ital) => WEIGHTS.map((w) => `${ital},${w}`))): string {
  return `${CSS2_ENDPOINT}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${styles.join(';')}`
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

/** The subset value that loads every named subset as one font (subsets.ts). */
export const ALL_SUBSETS = 'all'

/** Subsets Google names (latin, cyrillic, …); not the numbered slices it cuts large CJK fonts into ("[12]"). */
export function namedSubsets(info: Pick<GoogleFamilyInfo, 'subsets'>): string[] {
  return info.subsets.filter((s) => !/^\[\d+\]$/.test(s))
}

/** Every named subset when there are any (the whole font), else the first slice. */
export function defaultSubset(info: GoogleFamilyInfo): string {
  return namedSubsets(info).length ? ALL_SUBSETS : info.subsets[0]
}

export function defaultWeight(weights: number[]): number {
  if (weights.includes(400)) return 400
  return weights.reduce((best, w) => (Math.abs(w - 400) < Math.abs(best - 400) ? w : best), weights[0])
}

/**
 * The faces Google serves when asked for one weight and style only: static files made for that weight,
 * when Google can make them. On failure the variable file is used and weighted on load.
 */
async function fetchStaticFace(request: GoogleFontRequest, signal: AbortSignal): Promise<GoogleFace[]> {
  try {
    const response = await fetch(css2Url(request.family, [`${request.italic ? 1 : 0},${request.weight}`]), { signal })
    return response.ok ? parseFontFaces(await response.text()) : []
  } catch (error) {
    if (isAbortError(error)) throw error
    return []
  }
}

/**
 * Downloads the font binary for one face (or, with "all", one file per named subset, bundled) and parses it into the
 * shared font model.
 */
export async function loadGoogleFont(request: GoogleFontRequest, signal: AbortSignal): Promise<LoadedFont> {
  const info = await fetchGoogleFamily(request.family, signal)
  const style: FontStyle = request.italic ? 'italic' : 'normal'
  const wanted = request.subset === ALL_SUBSETS ? namedSubsets(info) : [request.subset]
  const matches = (f: GoogleFace) => f.style === style && f.weight === request.weight && wanted.includes(f.subset)
  let faces = info.faces.filter(matches)
  if (faces.length && info.variable) {
    const statics = (await fetchStaticFace(request, signal)).filter(matches)
    faces = faces.map((face) => statics.find((s) => s.subset === face.subset) ?? face)
  }
  if (!faces.length) {
    throw new FontLoadError(
      'api',
      `${request.family} has no ${style} ${request.weight} face in the "${request.subset}" subset.`,
    )
  }
  // The main subset first: its names and metrics are the font's.
  faces.sort((a, b) => Number(b.subset === 'latin') - Number(a.subset === 'latin'))

  const files = await Promise.all(faces.map((face) => download(face.url, signal)))
  signal.throwIfAborted()
  const bytes = files.length === 1 ? files[0] : bundleSubsets(files)

  return parseFont(
    bytes,
    {
      kind: 'google',
      family: request.family,
      weight: request.weight,
      italic: request.italic,
      subset: request.subset,
      version: /\/(v\d+)\//.exec(faces[0].url)?.[1] ?? null,
      fileUrl: faces[0].url,
      byteSize: bytes.byteLength,
    },
    signal,
  )
}

async function download(url: string, signal: AbortSignal): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new FontLoadError('download', 'Could not download the font file from fonts.gstatic.com.')
  }
  if (!response.ok) {
    throw new FontLoadError('download', `fonts.gstatic.com returned HTTP ${response.status} for the font file.`)
  }
  try {
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new FontLoadError('download', 'The font download was interrupted.')
  }
}
