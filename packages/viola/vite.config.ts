import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import { visualizer } from 'rollup-plugin-visualizer';
import sirv from 'sirv';
import { defineConfig, loadEnv, type Plugin, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// @ts-expect-error
import { getProjectRoot } from '@v/config/get-project-root.js';

const secretsDir = path.join(getProjectRoot(), 'secrets');
const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));

const serveCli = () =>
  ({
    name: 'serve-cli',
    enforce: 'pre',
    configureServer(server) {
      const dir = path.resolve(
        require.resolve('@v/cli-bundle/package.json'),
        '../dist',
      );
      server.middlewares.use(
        '/_cli',
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
    resolveId(id) {
      if (id === '#cli-bundle') {
        return '@v/cli-bundle';
      }
    },
    load(id) {
      if (id === '@v/cli-bundle') {
        return '';
      }
    },
    transform(_code, id) {
      if (id === '@v/cli-bundle') {
        // skip transform
        return `export default ((f) => import(/* @vite-ignore */ f))('/_cli/index.js')`;
      }
    },
    closeBundle() {
      const src = path.resolve(
        require.resolve('@v/cli-bundle/package.json'),
        '../dist',
      );
      const dest = path.join(dirname, 'dist/_cli');
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
    },
  }) satisfies Plugin;

const serviceWorker = () => [
  VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src/client',
    filename: 'sw.ts',
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
    name: 'iframe-html-dev',
    enforce: 'post',
    apply: 'serve',
    config(config) {
      config.define = {
        ...config.define,
        'import.meta.env.VITE_IFRAME_HTML': JSON.stringify(
          fs.readFileSync(path.join(dirname, 'iframe.html'), 'utf8'),
        ),
      };
      return config;
    },
  } satisfies Plugin,
  {
    name: 'iframe-html-build',
    enforce: 'post',
    apply: 'build',
    config(config) {
      config.define = {
        ...config.define,
        'import.meta.env.VITE_IFRAME_HTML': JSON.stringify('__IFRAME_HTML__'),
      };
      return config;
    },
    closeBundle: {
      sequential: true,
      handler() {
        const html = fs.readFileSync(
          path.join(dirname, 'dist/iframe.html'),
          'utf8',
        );
        const swFilename = path.join(dirname, 'dist/sw.js');
        fs.writeFileSync(
          swFilename,
          fs
            .readFileSync(swFilename, 'utf8')
            .replace(/"__IFRAME_HTML__"/g, JSON.stringify(html)),
          'utf8',
        );
      },
    },
  } satisfies Plugin,
];

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, secretsDir);

  return {
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(dirname, 'index.html'),
          iframe: path.resolve(dirname, 'iframe.html'),
        },
      },
      assetsDir: 'assets',
    },
    worker: {
      format: 'es',
      plugins: () => [serveCli()],
    },
    plugins: [
      TanStackRouterVite(),
      react(),
      tailwindcss(),
      serviceWorker(),
      serveCli(),
      visualizer() as PluginOption,
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
        origin: new RegExp(
          `^https?://([\\w-]+\\.)?${env.VITE_APP_HOSTNAME.replace('.', '\\.')}(?::\\d+)$`,
        ),
      },
    },
    envDir: secretsDir,
  };
});
