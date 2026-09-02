import { defineConfig } from '@rstest/core';

// Docs: https://rstest.rs/config/
export default defineConfig({
  testEnvironment: 'jsdom',
  setupFiles: ['./rstest.setup.ts'],
  // Only our own suite: `.direnv` and `.pnpm-store` contain copies of this repo.
  include: ['tests/**/*.test.ts'],
  exclude: [
    // Statistical arena runs at full physics; minutes, not seconds. See
    // `npm run test:slow` and rstest.slow.config.ts.
    'tests/slow/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/.direnv/**',
    '**/.pnpm-store/**',
  ],
});
