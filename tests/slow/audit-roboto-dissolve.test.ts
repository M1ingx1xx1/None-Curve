// The slow audit of Roboto (see audit-roboto.test.ts): the configurations with Dissolve on plain Geometry.

import { auditPart, CONFIGS, geometryInvariants } from '../helpers/invariants'

geometryInvariants('Roboto', CONFIGS.filter((c) => auditPart(c) === 'dissolve'), { glyphs: 'all', recheckScale: 10 })
