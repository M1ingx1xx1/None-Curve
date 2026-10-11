// The live seed beside a seed field that Sound drives: the seed the letters use now, while the field
// keeps the seed the user set (see docs/SOUND_PLAN.md §5). The seed counterpart of LiveMarker.

import { useLiveSeed } from '../sound/live'

/**
 * Shows the seed Sound has moved this target to, or nothing while Sound does not drive it. Place it in
 * the field's `.seed-row`, right after the number input. Decoration only (aria-hidden): the field keeps
 * announcing its own seed.
 */
export default function LiveSeed({ target }: { target: string }) {
  const seed = useLiveSeed(target)
  if (seed === null) return null
  return (
    <span className="live-seed" aria-hidden="true" title="Live seed">
      {seed}
    </span>
  )
}
