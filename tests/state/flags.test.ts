// The runtime switches (src/state/flags.ts): URL first, then storage, then the defaults; bad values fall through.

import { describe, expect, it } from 'vitest'
import { DEFAULT_FLAGS, parseFlags } from '../../src/state/flags'

const none = () => null
const storage = (values: Record<string, string>) => (key: string) => values[key] ?? null

describe('parseFlags', () => {
  it('gives the defaults with nothing set', () => {
    expect(parseFlags('', none)).toEqual(DEFAULT_FLAGS)
  })

  it('reads every URL parameter', () => {
    expect(parseFlags('?render=canvas&precompute=0&workerplans=0&probe=1', none)).toEqual({
      render: 'canvas',
      precompute: false,
      workerPlans: false,
      probe: true,
    })
  })

  it('prefers the URL to storage, and storage to the defaults', () => {
    const stored = storage({
      'none-curve:render': 'svg',
      'none-curve:precompute': '0',
      'none-curve:workerplans': 'false',
    })
    expect(parseFlags('render=webgl', stored)).toEqual({
      render: 'webgl',
      precompute: false,
      workerPlans: false,
      probe: false,
    })
  })

  it('ignores invalid values and storage that throws', () => {
    const throwing = () => {
      throw new Error('blocked')
    }
    expect(parseFlags('?render=metal&precompute=maybe&probe=yes', throwing)).toEqual(DEFAULT_FLAGS)
    expect(parseFlags('?render=metal', storage({ 'none-curve:render': 'canvas' })).render).toBe('canvas')
  })

  it('does not read probe from storage', () => {
    expect(parseFlags('', storage({ 'none-curve:probe': '1', probe: '1' })).probe).toBe(false)
  })
})
