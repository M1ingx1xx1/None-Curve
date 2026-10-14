// The geometry invariants of tests/helpers/invariants.ts on every glyph with an outline in STIXTwoText (Greek, Cyrillic,
// symbols and accents included), not only the Latin sample. One file per font, so the fonts run in parallel.

import { CONFIGS, geometryInvariants } from '../helpers/invariants'

geometryInvariants('STIXTwoText', CONFIGS, { glyphs: 'all', recheckScale: 10 })
