import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import sirv from 'sirv';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const root = path.join(fileURLToPath(import.meta.url), '..');
const require = createRequire(import.meta.url);

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
    {
      name: 'serve-worker-dir',
      configureServer(server) {
        const dir = path.dirname(require.resolve('@v/cli-bundle/dist/cli.js'));
        server.middlewares.use(
          '/@worker',
          sirv(dir, {
            dev: true,
            etag: false,
            setHeaders: (res) => {
              res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
              res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
              res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            },
          }),
        );
      },
    },
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
