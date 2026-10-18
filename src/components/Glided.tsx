import { useSyncExternalStore, type ReactNode } from 'react'
import type { SpecimenScene } from '../specimen/scene'
import type { GlideStore } from '../state/useGlide'

/**
 * Draws `scene` as Glide shows it now (state/useGlide.ts): the in-between shapes while a glide is on its way. Only this
 * subtree re-renders with each animation frame. Until the store has the scene (the render before its layout effect),
 * the scene itself is drawn.
 */
export default function Glided({ store, scene, children }: { store: GlideStore; scene: SpecimenScene | null; children: (scene: SpecimenScene | null) => ReactNode }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <>{children(snapshot.target === scene ? snapshot.scene : scene)}</>
}
