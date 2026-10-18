// A fake geometry Worker for the page's side of the workers (src/state/geometryClient.ts): it records what the page
// sends, and a test answers for it.

import type { WorkerRequest, WorkerResponse } from '../../src/geometry/protocol'

export class FakeWorker {
  readonly received: WorkerRequest[] = []
  terminated = false
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage(message: WorkerRequest) {
    this.received.push(message)
  }
  terminate() {
    this.terminated = true
  }
  /** The worker answers the page. */
  reply(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>)
  }
  /** The newest compute request it was sent. */
  get lastRequest() {
    return this.received.filter((m) => m.type === 'compute').at(-1) as Extract<WorkerRequest, { type: 'compute' }>
  }
  /** The newest compute request's id and its first job. */
  get lastCompute() {
    const { requestId, jobs } = this.lastRequest
    return { requestId, ...jobs[0] }
  }
  /** Compute requests sent so far. */
  get computes() {
    return this.received.filter((m) => m.type === 'compute').length
  }
}
