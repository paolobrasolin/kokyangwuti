import { defineConfig } from '@rsbuild/core';

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  server: {
    base: '/kokyangwuti/',
  },
  html: {
    title: 'kokyangwuti',
    inject: 'body',
  },
  output: {
    inlineScripts: true,
    inlineStyles: true,
  },
  performance: {
    // One self-contained chunk per entry. The simulation runs in a Web Worker
    // (`src/engine/worker.ts`); with the default splitting its shared modules
    // land in a chunk that is inlined into the HTML and never emitted as a
    // file, so the worker's `importScripts` of it would 404.
    chunkSplit: { strategy: 'all-in-one' },
  },
});
