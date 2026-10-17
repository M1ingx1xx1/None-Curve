// The slow audit of STIXTwoText (see audit-stix.test.ts): the configurations with Dissolve on plain Geometry.

import { auditPart, CONFIGS, geometryInvariants } from '../helpers/invariants'

geometryInvariants('STIXTwoText', CONFIGS.filter((c) => auditPart(c) === 'dissolve'), { glyphs: 'all', recheckScale: 10 })
