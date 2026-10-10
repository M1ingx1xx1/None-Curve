// Parses what a user pastes into the Google Fonts dialog: a plain family name or a Google Fonts URL.
// Only HTTPS URLs on fonts.google.com and fonts.googleapis.com are accepted; the URL is never
// fetched — only the family and style are extracted and passed to the normal CSS2 loader.
// No React, no DOM.

export interface ParsedFontRequest {
  family: string
  /** Requested weight, if the input named one. */
  weight: number | null
  /** Requested style, if the input named one. */
  italic: boolean | null
  /** Variation axes in the URL that the app cannot apply (everything except wght and ital). */
  unsupportedAxes: string[]
  /** Plain-language notes about what was ignored or simplified. */
  notes: string[]
  /** Where the request came from. */
  source: 'name' | 'specimen' | 'css2' | 'css'
}

export type ParseResult = { ok: true; request: ParsedFontRequest } | { ok: false; error: string }

const ALLOWED_HOSTS = ['fonts.google.com', 'fonts.googleapis.com']
const SUPPORTED_FORMS =
  'Supported: https://fonts.google.com/specimen/Family+Name, https://fonts.googleapis.com/css2?family=…, or https://fonts.googleapis.com/css?family=….'

/** True when the input should be treated as a URL rather than a family name. */
export function looksLikeUrl(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) || /^(www\.)?fonts\.(google|googleapis)\.com\//i.test(input.trim())
}

function cleanFamily(raw: string): string {
  return raw.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim()
}

function validFamily(family: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 \-']{0,79}$/.test(family)
}

export function parseFontInput(input: string): ParseResult {
  const text = input.trim()
  if (!text) return { ok: false, error: 'Enter a family name or a Google Fonts URL.' }
  if (!looksLikeUrl(text)) {
    const family = cleanFamily(text)
    if (!validFamily(family)) return { ok: false, error: `“${text}” is not a valid font family name.` }
    return { ok: true, request: { family, weight: null, italic: null, unsupportedAxes: [], notes: [], source: 'name' } }
  }

  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return { ok: false, error: `This is not a valid URL. ${SUPPORTED_FORMS}` }
  }
  if (url.protocol !== 'https:') return { ok: false, error: `Only https:// Google Fonts URLs are accepted. ${SUPPORTED_FORMS}` }
  if (url.username || url.password || url.port) return { ok: false, error: `URLs with credentials or ports are not accepted. ${SUPPORTED_FORMS}` }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!ALLOWED_HOSTS.includes(host)) {
    return { ok: false, error: `Only fonts.google.com and fonts.googleapis.com URLs are accepted, not ${url.hostname}. ${SUPPORTED_FORMS}` }
  }

  if (host === 'fonts.google.com') {
    const specimen = /^\/specimen\/([^/]+)\/?$/.exec(url.pathname)
    if (specimen) {
      const family = cleanFamily(decodeURIComponent(specimen[1]))
      if (!validFamily(family)) return { ok: false, error: `The URL does not contain a valid family name.` }
      const ignored = [...url.searchParams.keys()]
      return {
        ok: true,
        request: {
          family,
          weight: null,
          italic: null,
          unsupportedAxes: [],
          notes: ignored.length ? [`Ignored URL parameters: ${ignored.join(', ')}.`] : [],
          source: 'specimen',
        },
      }
    }
    return { ok: false, error: `This fonts.google.com page does not name a font. ${SUPPORTED_FORMS}` }
  }

  // fonts.googleapis.com
  const path = url.pathname.replace(/\/$/, '')
  if (path !== '/css2' && path !== '/css') return { ok: false, error: `Unsupported fonts.googleapis.com path “${url.pathname}”. ${SUPPORTED_FORMS}` }
  const families = url.searchParams.getAll('family').flatMap((f) => (path === '/css' ? f.split('|') : [f]))
  if (!families.length || !families[0]) return { ok: false, error: 'The URL has no family parameter.' }
  const notes: string[] = []
  if (families.length > 1) notes.push(`The URL lists ${families.length} families; only “${cleanFamily(families[0].split(':')[0])}” is loaded.`)
  const ignored = [...new Set([...url.searchParams.keys()].filter((k) => k !== 'family'))]
  if (ignored.length) notes.push(`Ignored URL parameters: ${ignored.join(', ')}.`)

  const [rawName, spec = ''] = families[0].split(':')
  const family = cleanFamily(rawName)
  if (!validFamily(family)) return { ok: false, error: 'The URL does not contain a valid family name.' }
  const parsed = path === '/css2' ? parseCss2Spec(spec) : parseCss1Spec(spec)
  return { ok: true, request: { family, ...parsed, notes: [...notes, ...parsed.notes], source: path === '/css2' ? 'css2' : 'css' } }
}

/** css2 axis spec, e.g. "ital,wght@0,400;1,700", "wght@300..700", or "opsz,wght@8..144,400". */
function parseCss2Spec(spec: string): Pick<ParsedFontRequest, 'weight' | 'italic' | 'unsupportedAxes' | 'notes'> {
  const result = { weight: null as number | null, italic: null as boolean | null, unsupportedAxes: [] as string[], notes: [] as string[] }
  if (!spec) return result
  const [axesPart, valuesPart = ''] = spec.split('@')
  const axes = axesPart.split(',').map((a) => a.trim())
  result.unsupportedAxes = axes.filter((a) => a !== 'wght' && a !== 'ital')
  const tuples = valuesPart.split(';').filter(Boolean)
  if (!tuples.length) return result
  if (tuples.length > 1) result.notes.push(`The URL requests ${tuples.length} styles; the first one is used.`)
  const values = tuples[0].split(',')
  axes.forEach((axis, i) => {
    const value = values[i] ?? ''
    if (axis === 'ital') result.italic = value === '1'
    if (axis === 'wght') {
      const range = /^(\d+)\.\.(\d+)$/.exec(value)
      if (range) {
        result.notes.push(`Weight range ${value} requested; choose a weight to load.`)
      } else if (/^\d+$/.test(value)) {
        result.weight = Number(value)
      }
    }
  })
  return result
}

/** Legacy css spec, e.g. "400,700italic" or "300i". */
function parseCss1Spec(spec: string): Pick<ParsedFontRequest, 'weight' | 'italic' | 'unsupportedAxes' | 'notes'> {
  const result = { weight: null as number | null, italic: null as boolean | null, unsupportedAxes: [] as string[], notes: [] as string[] }
  if (!spec) return result
  const variants = spec.split(',').filter(Boolean)
  if (variants.length > 1) result.notes.push(`The URL requests ${variants.length} styles; the first one is used.`)
  const first = variants[0].toLowerCase()
  const match = /^(\d{3})?(italic|i)?$/.exec(first) ?? (first === 'bold' ? ['', '700', undefined] : first === 'regular' ? ['', '400', undefined] : null)
  if (match) {
    if (match[1]) result.weight = Number(match[1])
    result.italic = Boolean(match[2])
  } else {
    result.notes.push(`Could not read the style “${variants[0]}”; the default style is used.`)
  }
  return result
}
