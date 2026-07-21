import { defineConfig } from 'vitest/config';

// NOTE: We intentionally do NOT use @vitejs/plugin-react here. That plugin
// injects a React Fast Refresh "preamble" intended for the dev server, which
// does not exist in the jsdom test runtime and causes
// "@vitejs/plugin-react can't detect preamble" errors when JSX modules are
// imported in tests. Fast Refresh is irrelevant under test, so we let
// Vitest's built-in transform (oxc, as of Vitest 4) handle JSX with the
// automatic runtime by default — no explicit jsx option needed.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
