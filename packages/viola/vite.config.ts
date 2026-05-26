import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import { visualizer } from 'rollup-plugin-visualizer';
import sirv from 'sirv';
import * as tar from 'tar';
import { defineConfig, loadEnv, type Plugin, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// @ts-expect-error
import { getProjectRoot } from '@v/config/get-project-root.js';

const secretsDir = path.join(getProjectRoot(), 'secrets');
const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));

const templatesDir = path.join(dirname, 'templates');

const createTemplateTgz = (templateName: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = tar.create(
      {
        gzip: true,
        cwd: path.join(templatesDir, templateName),
        portable: true,
      },
      ['.'],
    ) as unknown as NodeJS.ReadableStream;
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};

const serveTemplates = () =>
  ({
    name: 'serve-templates',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use('/_templates', async (req, res, next) => {
        const match = req.url?.match(/^\/([^/]+)\.tar\.gz$/);
        if (!match) return next();
        const templateName = match[1];
        const templatePath = path.join(templatesDir, templateName);
        if (!fs.existsSync(templatePath)) return next();
        try {
          const buf = await createTemplateTgz(templateName);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/gzip');
          res.setHeader('Content-Length', buf.length);
          res.end(buf);
        } catch (e) {
          next(e);
        }
      });
    },
    async closeBundle() {
      const entries = fs.readdirSync(templatesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const buf = await createTemplateTgz(entry.name);
        const destDir = path.join(dirname, 'dist/_templates');
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, `${entry.name}.tar.gz`), buf);
      }
    },
  }) satisfies Plugin;

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

interface ServeApiOptions {
  /**
   * SQLite database path forwarded to `createApiDevServer`. When unset, the
   * API uses an in-memory store and all data is lost on dev server restart.
   */
  sqlitePath?: string;
  /** Forwarded to `createApiDevServer`'s `projectFilePath`. */
  projectFilePath?: string;
}

const serveApi = ({
  sqlitePath,
  projectFilePath,
}: ServeApiOptions = {}): Plugin => {
  let currentMiddleware:
    | ((
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse,
        next: (err?: unknown) => void,
      ) => void)
    | undefined;
  let basePath = '/api';

  return {
    name: 'serve-api',
    apply: 'serve',
    async configureServer(server) {
      // Use vite's own SSR loader. Vite's config-file loader uses Node's
      // strict ESM resolution which rejects the extensionless TS imports
      // used throughout `@v/api-server-reference`; the SSR loader runs
      // through vite's plugin pipeline and resolves them correctly.
      const loadApi = async () => {
        const mod = (await server.ssrLoadModule(
          '@v/api-server-reference/dev-server',
        )) as typeof import('@v/api-server-reference/dev-server');
        return mod.createApiDevServer({ sqlitePath, projectFilePath });
      };

      let api = await loadApi();
      currentMiddleware = api.middleware;
      basePath = api.basePath;

      // Single middleware registration that always delegates to the current
      // API instance, so swapping the instance on reload doesn't double-
      // register or leave dead handlers behind.
      server.middlewares.use((req, res, next) => {
        if (currentMiddleware) {
          currentMiddleware(req, res, next);
        } else {
          next();
        }
      });

      // Watch the reference server source. On change, invalidate vite's SSR
      // module cache and rebuild the API instance so HTTP routes hot-reload.
      // Vite's own watcher only fires for files inside its project root, so
      // poll the external workspace package with `fs.watchFile` instead.
      const apiSrc = path.resolve(dirname, '../api-server-reference/src');
      let reloadTimer: NodeJS.Timeout | undefined;
      const scheduleReload = (file: string) => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
          // Close the previous instance's SQLite handle before building a
          // new one. With a file path this would otherwise leak a
          // connection per reload until the process exits.
          api.close();
          // Clear the middleware reference so requests fall through to
          // `next()` while the new instance is loading (and stay falling-
          // through if the load fails, instead of hitting a closed handle).
          currentMiddleware = undefined;
          try {
            server.moduleGraph.invalidateAll();
            api = await loadApi();
            currentMiddleware = api.middleware;
            server.config.logger.info(
              `  \x1b[32m➜\x1b[0m  API reloaded (${path.relative(apiSrc, file)})`,
            );
          } catch (err) {
            server.config.logger.error(
              `  [api] reload failed: ${(err as Error).message}`,
            );
          }
        }, 100);
      };
      // Snapshot the file tree at startup; files added later won't be
      // watched until the dev server is restarted. Polling-based
      // `fs.watchFile` handles are intentionally not cleaned up — the
      // plugin lives for the lifetime of the dev server.
      const watchTree = (dir: string) => {
        for (const entry of fs.readdirSync(dir)) {
          const p = path.join(dir, entry);
          const stat = fs.statSync(p);
          if (stat.isDirectory()) {
            watchTree(p);
          } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
            fs.watchFile(p, { interval: 200 }, () => scheduleReload(p));
          }
        }
      };
      watchTree(apiSrc);

      // WebSocket upgrade has to be attached after vite binds `httpServer`,
      // and only once: hono-ws's listener cannot be removed cleanly, so WS
      // handlers do not hot-reload (HTTP routes do).
      return () => {
        if (server.httpServer) {
          api.injectWebSocket(server.httpServer);
        }
        server.config.logger.info(
          `  \x1b[32m➜\x1b[0m  API mounted at \x1b[36m${basePath}\x1b[0m  \x1b[2m[sqlite ${sqlitePath ?? ':memory:'}, files ${projectFilePath ?? ':memory: (vfs)'}]\x1b[0m`,
        );
      };
    },
  };
};

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
            .replace(/(["'`])__IFRAME_HTML__\1/g, () => JSON.stringify(html)),
          'utf8',
        );
      },
    },
  } satisfies Plugin,
];

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, secretsDir, ['VITE_', 'API_']);

  // Cloud (Account / API-backed projects) is enabled when an API base URL is
  // configured. The vite dev server mounts an in-process API at `/api`, so we
  // default to that when one isn't explicitly set. `VITE_DISABLE_CLOUD`
  // is an explicit kill-switch that wins over everything else.
  const apiBaseUrl =
    env.VITE_API_BASE_URL || (command === 'serve' ? '/api' : '');
  const cloudEnabled = env.VITE_DISABLE_CLOUD !== 'true' && Boolean(apiBaseUrl);

  return {
    define: {
      __CLOUD_ENABLED__: JSON.stringify(cloudEnabled),
      __API_BASE_URL__: JSON.stringify(cloudEnabled ? apiBaseUrl : ''),
    },
    build: {
      rolldownOptions: {
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
      paraglideVitePlugin({
        project: path.join(getProjectRoot(), 'project.inlang'),
        outdir: path.join(dirname, 'src/paraglide'),
        strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
        emitTsDeclarations: true,
      }),
      TanStackRouterVite(),
      react(),
      tailwindcss(),
      serviceWorker(),
      serveTemplates(),
      serveCli(),
      ...(cloudEnabled
        ? [
            serveApi({
              sqlitePath: env.API_SQLITE_PATH
                ? path.resolve(getProjectRoot(), env.API_SQLITE_PATH)
                : undefined,
              projectFilePath: env.API_PROJECT_FILE_PATH
                ? path.resolve(getProjectRoot(), env.API_PROJECT_FILE_PATH)
                : undefined,
            }),
          ]
        : []),
      visualizer() as PluginOption,
    ],
    server:
      command === 'serve'
        ? {
            https: {
              key: fs.readFileSync(path.join(secretsDir, 'certs/privkey.pem')),
              cert: fs.readFileSync(
                path.join(secretsDir, 'certs/fullchain.pem'),
              ),
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
          }
        : undefined,
    envDir: secretsDir,
  };
});
