// The geometry invariants of tests/helpers/invariants.ts on every glyph with an outline in Roboto (Greek, Cyrillic,
// symbols and accents included), not only the Latin sample. Split by auditPart into files that run in parallel:
// here, every configuration without Dissolve.

import { auditPart, CONFIGS, geometryInvariants } from '../helpers/invariants'

geometryInvariants(
  'Roboto',
  CONFIGS.filter((c) => auditPart(c) === 'main'),
  { glyphs: 'all', recheckScale: 10 },
)
