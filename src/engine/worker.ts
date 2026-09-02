/**
 * Web Worker entry point. Everything interesting is in `host.ts`; this file
 * only wires the host to the worker's message port.
 */

import { createWorkerHost } from './host';
import type { MainToWorker } from './protocol';

// The DOM lib types `self` as a Window; a dedicated worker's scope has the
// two-argument `postMessage`. Only that much of it is needed here.
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null;
};

const host = createWorkerHost((message, transfer) =>
  scope.postMessage(message, transfer ?? []),
);

scope.onmessage = (event) => host.onMessage(event.data);
