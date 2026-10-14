// Geometry worker: opens the font itself and runs the geometry pipeline off the page's main thread,
// so sliders, typing, and dragging stay smooth however long a glyph takes. The logic is in
// workerCore.ts; this file connects it to the worker's messages.

import type { WorkerRequest, WorkerResponse } from './protocol'
import { createGeometryWorker } from './workerCore'

const handle = createGeometryWorker((message: WorkerResponse) => (self as unknown as Worker).postMessage(message))

self.onmessage = (event: MessageEvent<WorkerRequest>) => handle(event.data)
