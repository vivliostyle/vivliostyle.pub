/// <reference types="vitest/config" />

import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json', 'html'],
      enabled: true,
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'src/**/*.test.ts',
            'testing/**/*.test.ts',
            'tests/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'properties',
          include: ['tests/properties/**/*.test.ts'],
        },
      },
    ],
  },
});
