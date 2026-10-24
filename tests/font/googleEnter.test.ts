// Which family Enter selects in the Google Fonts search field (src/font/googleUrl.ts): the typed one, never a stale pick.

import { describe, expect, it } from 'vitest'
import { enterChoice, parseFontInput } from '../../src/font/googleUrl'

const curated = ['Arvo', 'Inter', 'Roboto', 'Roboto Mono']
const choose = (typed: string) => enterChoice(typed, typed.trim() ? parseFontInput(typed) : null, curated)

describe('Enter in the Google Fonts search', () => {
  it('selects a curated name as listed, whatever its case', () => {
    expect(choose('Arvo')).toEqual({ family: 'Arvo', request: null })
    expect(choose(' arvo ')).toEqual({ family: 'Arvo', request: null })
  })

  it('selects the first curated family containing partial text', () => {
    expect(choose('robo')).toEqual({ family: 'Roboto', request: null })
  })

  it('selects an uncurated name or a URL as parsed', () => {
    expect(choose('Pacifico')?.family).toBe('Pacifico')
    expect(choose('Pacifico')?.request?.source).toBe('name')
    const url = choose('https://fonts.google.com/specimen/Lobster')
    expect(url?.family).toBe('Lobster')
    expect(url?.request?.source).toBe('specimen')
  })

  it('selects nothing for empty text or an unusable URL', () => {
    expect(choose('')).toBeNull()
    expect(choose('https://example.com/Arvo')).toBeNull()
  })
})
