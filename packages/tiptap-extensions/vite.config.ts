/// <reference types="vitest/config" />

import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json', 'html'],
      enabled: true,
    },
    // Turbo runs every package's tests at once on CI's few cores, where
    // the build artifact checks of cli-bundle then run out of time.
    maxWorkers: process.env.CI ? 1 : undefined,
  },
});
