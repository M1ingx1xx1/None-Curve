import { useCallback, useEffect, useRef, type Dispatch } from 'react'
import { isAbortError, toFontLoadError } from '../font/errors'
import { loadGoogleFont, type GoogleFontRequest } from '../font/google'
import { loadLocalFont } from '../font/local'
import type { LoadedFont } from '../font/model'
import { parseFont } from '../font/parse'
import type { Action } from './editorState'
import type { ImportOrigin } from './types'

type ImportJob = { origin: ImportOrigin; label: string; run: (signal: AbortSignal) => Promise<LoadedFont> }

/**
 * Runs font imports outside of React rendering. Each import aborts the previous one, and the reducer
 * ignores results from any request that is no longer active.
 */
export function useFontImport(dispatch: Dispatch<Action>) {
  const requestId = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const lastJob = useRef<ImportJob | null>(null)

  const start = useCallback(
    async (job: ImportJob) => {
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort
      lastJob.current = job
      const id = ++requestId.current
      dispatch({ type: 'importStarted', requestId: id, origin: job.origin, label: job.label })

      try {
        const font = await job.run(abort.signal)
        if (!abort.signal.aborted) dispatch({ type: 'importSucceeded', requestId: id, font })
      } catch (error) {
        if (abort.signal.aborted || isAbortError(error)) return
        const failure = toFontLoadError(error, job.origin === 'local' ? 'parse' : 'download')
        dispatch({
          type: 'importFailed',
          requestId: id,
          origin: job.origin,
          errorKind: failure.kind,
          message: failure.message,
        })
      } finally {
        if (controller.current === abort) controller.current = null
      }
    },
    [dispatch],
  )

  useEffect(() => () => controller.current?.abort(), [])

  const importLocal = useCallback(
    (file: File) =>
      start({ origin: 'local', label: `Reading ${file.name}`, run: (signal) => loadLocalFont(file, signal) }),
    [start],
  )

  const importGoogle = useCallback(
    (request: GoogleFontRequest) =>
      start({
        origin: 'google',
        label: `Downloading ${request.family} from Google Fonts`,
        run: (signal) => loadGoogleFont(request, signal),
      }),
    [start],
  )

  /** Opens another face of the font collection `font` came from; the file is already in memory. */
  const selectFace = useCallback(
    (font: LoadedFont, face: number) => {
      const { source } = font
      if (source.kind !== 'local') return
      const entry = font.faces?.find((f) => f.index === face)
      const label = !entry ? `face ${face + 1}` : entry.family === font.familyName ? entry.style : `${entry.family} ${entry.style}`
      void start({ origin: 'local', label: `Opening ${label}`, run: (signal) => parseFont(font.bytes, { ...source, face }, signal) })
    },
    [start],
  )

  const retry = useCallback(() => {
    if (lastJob.current) void start(lastJob.current)
  }, [start])

  const cancel = useCallback(() => {
    controller.current?.abort()
    dispatch({ type: 'importCancelled', requestId: requestId.current })
  }, [dispatch])

  return { importLocal, importGoogle, selectFace, retry, cancel }
}

export type FontImporter = ReturnType<typeof useFontImport>
