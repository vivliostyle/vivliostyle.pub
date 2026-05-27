import { defineConfig } from 'vitest/config';

// Build-time defines that viola modules reference at top level
// (`vite-env.d.ts:13-15`). vitest does not consume `vite.config.ts`'s define
// block, so we duplicate the minimum required pair here. The test sentinel
// host (`test.invalid`) is matched by `__tests__/setup.ts`'s fetch patch.
export default defineConfig({
  define: {
    __API_BASE_URL__: JSON.stringify('http://test.invalid/api'),
    __CLOUD_ENABLED__: JSON.stringify(true),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
