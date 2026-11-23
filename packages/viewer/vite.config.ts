import { defineConfig } from 'vite';

export default defineConfig({
  // The host decides the path prefix the stage is mounted under.
  base: './',
  build: {
    // `@vivliostyle/core` alone is a single ~850 kB module.
    chunkSizeWarningLimit: 1024,
  },
});
