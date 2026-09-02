import { defineConfig } from '@rstest/core';

// The slow suite: whole generations at full physics, several per test.
// `npm run test:slow`. Kept out of `npm test` so the fast suite stays fast.
export default defineConfig({
  testEnvironment: 'jsdom',
  setupFiles: ['./rstest.setup.ts'],
  include: ['tests/slow/**/*.test.ts'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.direnv/**',
    '**/.pnpm-store/**',
  ],
  testTimeout: 600000,
  hookTimeout: 600000,
});
