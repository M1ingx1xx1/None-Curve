// Feature worker: measures a file's sound ahead of the playhead off the page's main thread (the FFT and pitch
// tracking are the heavy part of a frame). The logic is in featureWorkerCore.ts; this file connects it to the
// worker's messages and measures a chunk at a time, so a seek or new settings are heard between chunks.

import { FeatureWorkerCore, type FeatureWorkerRequest, type FeatureWorkerResponse } from './featureWorkerCore'

const core = new FeatureWorkerCore((message: FeatureWorkerResponse, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(message, transfer ?? []),
)

let scheduled = false

function run() {
  scheduled = false
  if (core.step()) schedule()
}

function schedule() {
  if (scheduled) return
  scheduled = true
  setTimeout(run, 0)
}

self.onmessage = (event: MessageEvent<FeatureWorkerRequest>) => {
  core.handle(event.data)
  schedule()
}
