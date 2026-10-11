// React access to the page's sound engine. State changes re-render (a few times a second at most);
// measured frames never do: components that draw them (the meters) subscribe and write to the DOM.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { getSoundEngine, type SoundEngine } from './engine'
import type { FeatureFrame, SoundState } from './types'

// Module-level, so useSyncExternalStore sees the same functions on every render and subscribes once.
const subscribeState = (listener: () => void) => getSoundEngine().subscribeState(listener)
const getState = () => getSoundEngine().getState()

/** The engine itself, for actions (play, loadFile, startMicrophone, …). */
export function useSoundEngine(): SoundEngine {
  return getSoundEngine()
}

/** The engine's state; re-renders when it changes (not on every frame). */
export function useSoundState(): SoundState {
  return useSyncExternalStore(subscribeState, getState)
}

/**
 * Calls `onFrame` with every measured frame without re-rendering: meters update the DOM directly.
 * The subscription is made once per mount; a new `onFrame` on a later render simply replaces the
 * old one, so it need not be memoised.
 */
export function useSoundFrames(onFrame: (frame: FeatureFrame) => void): void {
  const latest = useRef(onFrame)
  // Layout effect: in place before the next animation frame can deliver a frame.
  useLayoutEffect(() => {
    latest.current = onFrame
  }, [onFrame])
  useEffect(() => getSoundEngine().subscribeFrames((frame) => latest.current(frame)), [])
}
