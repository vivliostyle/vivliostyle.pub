import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const root = path.join(fileURLToPath(import.meta.url), '..');

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/client',
      filename: 'service-worker.ts',
      injectRegister: null,
      manifest: false,
      injectManifest: {
        injectionPoint: undefined,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    https: {
      key: fs.readFileSync(path.join(root, 'certs/privkey.pem')),
      cert: fs.readFileSync(path.join(root, 'certs/cert.pem')),
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
});
