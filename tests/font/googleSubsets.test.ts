// Loading a Google font in every subset (src/font/google.ts with "all"), against a fake Google: one file per named
// subset is downloaded, the main (latin) one first, and the numbered slices of large fonts are left out.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALL_SUBSETS, defaultSubset, loadGoogleFont, namedSubsets } from '../../src/font/google'
import { fixtureBytes } from '../helpers/fonts'

const face = (subset: string, file: string) =>
  `/* ${subset} */\n@font-face {\n  font-family: 'Fake';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/s/fake/v3/${file}.ttf) format('truetype');\n}\n`
const CSS = face('greek', 'stix') + face('[7]', 'slice') + face('latin', 'roboto')

describe('a Google font in every subset', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('names the subsets and loads them all by default', () => {
    const info = { subsets: ['greek', '[7]', 'latin'] }
    expect(namedSubsets(info)).toEqual(['greek', 'latin'])
    expect(
      defaultSubset({ ...info, family: 'Fake', faces: [], weights: { normal: [], italic: [] }, variable: false }),
    ).toBe(ALL_SUBSETS)
  })

  it('downloads every named subset, latin first, and opens them as one font', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      if (url.startsWith('https://fonts.googleapis.com/')) return new Response(CSS)
      const name = /\/(\w+)\.ttf$/.exec(url)![1]
      return new Response(fixtureBytes(name === 'roboto' ? 'Roboto' : 'STIXTwoText').slice())
    })
    const request = { family: 'Fake', weight: 400, italic: false, subset: ALL_SUBSETS }
    const font = await loadGoogleFont(request, new AbortController().signal)
    expect(asked.filter((url) => url.includes('gstatic')).sort()).toEqual([
      'https://fonts.gstatic.com/s/fake/v3/roboto.ttf',
      'https://fonts.gstatic.com/s/fake/v3/stix.ttf',
    ])
    expect(font.familyName).toBe('Roboto')
    expect(font.source).toMatchObject({ kind: 'google', subset: ALL_SUBSETS, version: 'v3' })
    expect(font.source.kind === 'google' && font.source.fileUrl).toMatch(/roboto/)
    const roboto = fixtureBytes('Roboto')
    expect(font.bytes.byteLength).toBeGreaterThan(roboto.byteLength)
  })
})
