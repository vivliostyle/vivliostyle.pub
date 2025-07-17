import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import sirv from 'sirv';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// @ts-expect-error
import { getProjectRoot } from '@v/config/get-project-root.js';

const secretsDir = path.join(getProjectRoot(), 'secrets');
const require = createRequire(import.meta.url);

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, secretsDir);

  return {
    plugins: [
      TanStackRouterVite(),
      react(),
      tailwindcss(),
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
        name: 'serve-cli',
        enforce: 'pre',
        configureServer(server) {
          const dir = path.resolve(
            require.resolve('@v/cli-bundle/package.json'),
            '../dist',
          );
          server.middlewares.use(
            '/@cli',
            sirv(dir, {
              dev: true,
              etag: false,
              setHeaders: (res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader(
                  'Access-Control-Allow-Headers',
                  'Origin, Content-Type, Accept, Range',
                );
                res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
              },
            }),
          );
        },
        load(id) {
          if (id === '@v/cli-bundle') {
            return '';
          }
        },
        transform(_code, id) {
          if (id === '@v/cli-bundle') {
            // skip transform
            return `export default ((f) => import(/* @vite-ignore */ f))('/@cli/index.js')`;
          }
        },
      },
    ],
    server: {
      https: {
        key: fs.readFileSync(path.join(secretsDir, 'certs/privkey.pem')),
        cert: fs.readFileSync(path.join(secretsDir, 'certs/fullchain.pem')),
      },
      headers: {
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
      allowedHosts: [
        // Leading dot allows any subdomains
        `.${env.VITE_APP_HOSTNAME}`,
      ],
      cors: {
        origin: [
          new RegExp(
            `^https?://${env.VITE_APP_HOSTNAME.replace('.', '\\.')}(?::\\d+)$`,
          ),
          new RegExp(
            `^https?://${env.VITE_SANDBOX_HOSTNAME.replace('.', '\\.')}(?::\\d+)$`,
          ),
        ],
      },
    },
    envDir: secretsDir,
  };
});
