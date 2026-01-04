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
});
