// The slow audit of STIXTwoText (see audit-stix.test.ts): the configurations with Dissolve on dense and heavy Geometry.

import { auditPart, CONFIGS, geometryInvariants } from '../helpers/invariants'

geometryInvariants(
  'STIXTwoText',
  CONFIGS.filter((c) => auditPart(c) === 'dissolve-geometry'),
  { glyphs: 'all', recheckScale: 10 },
)
