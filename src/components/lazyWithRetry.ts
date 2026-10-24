import { createElement, lazy, type ComponentType } from 'react'

/** Shown when a chunk will not load, usually in a tab opened before an update (the old files are gone). */
export const STALE_CHUNK_MESSAGE =
  'Part of the app could not be loaded. If the app was updated since this tab opened, reload the page.'

/**
 * React.lazy for a code-split component, except that a failed import is tried again. React.lazy keeps a rejected
 * import for good, so the ErrorBoundary's "Try again" would show the same error; here a failure swaps in a fresh lazy
 * component, and the next render (the retry) imports again.
 */
export function lazyWithRetry<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  const make = () =>
    lazy(() =>
      load().catch((error: unknown) => {
        Inner = make()
        throw new Error(STALE_CHUNK_MESSAGE, { cause: error })
      }),
    )
  let Inner = make()
  return function LazyWithRetry(props: P) {
    return createElement(Inner as ComponentType<P>, props)
  }
}
