// Worker-thread entry for the parallel runner: one seed per thread.
import { parentPort, workerData } from 'node:worker_threads';
import { type RunOptions, runSeed } from './headless';

const port = parentPort;
if (!port) throw new Error('run-worker.ts must be started as a worker thread');

const summary = runSeed(workerData as RunOptions, (event) =>
  port.postMessage({ type: 'generation', event }),
);
port.postMessage({ type: 'done', summary });
