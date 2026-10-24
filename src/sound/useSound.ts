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

/** The state without the file's position (useSteadySoundState). */
export type SteadySoundState = Omit<SoundState, 'position'>

let lastSteady: SoundState | null = null
/** The engine's state as last changed in anything but the position, which ticks about 4 times a second while a file plays. */
function steadyState(): SteadySoundState {
  const state = getState()
  const last = lastSteady
  if (last === state) return state
  if (!last || (Object.keys(state) as (keyof SoundState)[]).some((key) => key !== 'position' && state[key] !== last[key])) {
    lastSteady = state
  }
  return lastSteady ?? state
}

/** The engine's state but its position; re-renders only when something else changes (the transport's controls). */
export function useSteadySoundState(): SteadySoundState {
  return useSyncExternalStore(subscribeState, steadyState)
}

/**
 * One part of the engine's state; re-renders only when it changes. `select` returns a primitive or a part of the
 * state as it is (state.settings), never a new object.
 */
export function useSoundValue<T>(select: (state: SoundState) => T): T {
  return useSyncExternalStore(subscribeState, () => select(getState()))
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
