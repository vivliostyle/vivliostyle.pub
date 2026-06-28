import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import { invariant } from 'outvariant';
import { visualizer } from 'rollup-plugin-visualizer';
import sirv from 'sirv';
import * as tar from 'tar';
import {
  defineConfig,
  loadEnv,
  type Plugin,
  type PluginOption,
  type ResolvedConfig,
} from 'vite';
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

const serveTemplates = () => {
  let config: ResolvedConfig | undefined;
  return {
    name: 'serve-templates',
    enforce: 'pre',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
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
      invariant(config, 'Vite config not resolved');
      const entries = fs.readdirSync(templatesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const buf = await createTemplateTgz(entry.name);
        const destDir = path.join(config.build.outDir, '_templates');
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, `${entry.name}.tar.gz`), buf);
      }
    },
  } satisfies Plugin;
};

const serveCli = () => {
  let config: ResolvedConfig | undefined;
  return {
    name: 'serve-cli',
    enforce: 'pre',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
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
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
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
      invariant(config, 'Vite config not resolved');
      const src = path.resolve(
        require.resolve('@v/cli-bundle/package.json'),
        '../dist',
      );
      const dest = path.join(config.build.outDir, '_cli');
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
    },
  } satisfies Plugin;
};

// Extensions are the workspace packages named `@v/viola-extension-<id>`,
// enumerated through pnpm itself so they are found wherever the workspace
// places them. Discovery runs once per Vite startup; restart the dev server
// after adding or removing an extension package.
const discoverViolaExtensions = (): { id: string; packageDir: string }[] => {
  const projects: { name?: string; path: string }[] = JSON.parse(
    execFileSync('pnpm', ['m', 'ls', '--json', '--depth', '-1'], {
      cwd: getProjectRoot(),
      encoding: 'utf8',
    }),
  );
  const prefix = '@v/viola-extension-';
  const referenceSuffix = '-reference';
  const byId = new Map<string, { packageDir: string; isReference: boolean }>();
  for (const project of projects) {
    if (!project.name?.startsWith(prefix)) {
      continue;
    }
    const rawId = project.name.slice(prefix.length);
    const isReference = rawId.endsWith(referenceSuffix);
    const id = isReference ? rawId.slice(0, -referenceSuffix.length) : rawId;
    const existing = byId.get(id);
    if (!existing || (existing.isReference && !isReference)) {
      byId.set(id, { packageDir: project.path, isReference });
    }
  }
  return [...byId].map(([id, { packageDir }]) => ({ id, packageDir }));
};

const installedExtensions = () => {
  const moduleId = '#installed-extensions';
  // A `#` inside a module id would be cut off as a URL fragment when the dev
  // server rewrites imports, so the resolved id must not contain it.
  const resolvedModuleId = '\0virtual:installed-extensions';
  return {
    name: 'installed-extensions',
    resolveId(id) {
      if (id === moduleId) {
        return resolvedModuleId;
      }
    },
    load(id) {
      if (id !== resolvedModuleId) {
        return;
      }
      // Message catalogs are imported statically (not `import()`d) so the host
      // can read titles synchronously and views get them without a round-trip.
      const imports: string[] = [];
      const entries = discoverViolaExtensions().map(({ id, packageDir }, i) => {
        const viewsDir = path.join(packageDir, 'src/views');
        const views = (
          fs.existsSync(viewsDir)
            ? fs.readdirSync(viewsDir, { recursive: true, encoding: 'utf8' })
            : []
        )
          .filter((file) => file.endsWith('.tsx'))
          .map((file) => {
            const sub = file
              .split(path.sep)
              .join('/')
              .replace(/\.tsx$/, '')
              .replace(/(^|\/)index$/, '');
            const panePath = sub ? `./${sub}` : '.';
            return `${JSON.stringify(panePath)}: () => import(${JSON.stringify(
              path.join(viewsDir, file),
            )})`;
          });
        const messagesDir = path.join(packageDir, 'messages');
        const messages = (
          fs.existsSync(messagesDir) ? fs.readdirSync(messagesDir) : []
        )
          .filter((file) => file.endsWith('.json'))
          .map((file) => {
            const locale = file.replace(/\.json$/, '');
            const binding = `messages_${i}_${locale.replace(/\W/g, '_')}`;
            imports.push(
              `import ${binding} from ${JSON.stringify(path.join(messagesDir, file))};`,
            );
            return `${JSON.stringify(locale)}: ${binding}`;
          });
        return `${JSON.stringify(id)}: {
    loadExtension: () => import(${JSON.stringify(path.join(packageDir, 'src/extension.ts'))}),
    loadView: { ${views.join(', ')} },
    messages: { ${messages.join(', ')} },
  }`;
      });
      return `${imports.join('\n')}\nexport const installedExtensions = {\n${entries
        .map((entry) => `  ${entry},\n`)
        .join('')}};\n`;
    },
  } satisfies Plugin;
};

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
          '@v/api-server-reference/middleware',
        )) as typeof import('@v/api-server-reference/middleware');
        return mod.createApiMiddleware({ sqlitePath, projectFilePath });
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

const serviceWorker = () => {
  let config: ResolvedConfig | undefined;
  return [
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
        // The iframe HTML is served raw by the service worker, bypassing Vite's
        // index-HTML transform, so the React Refresh preamble that
        // @vitejs/plugin-react-swc normally injects is missing.
        const preamble = `<script type="module">
        import { injectIntoGlobalHook } from "/@react-refresh";
        injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
      </script>`;
        const html = fs
          .readFileSync(path.join(dirname, 'iframe.html'), 'utf8')
          .replace('<script', `${preamble}\n<script`);
        config.define = {
          ...config.define,
          'import.meta.env.VITE_IFRAME_HTML': JSON.stringify(html),
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
      configResolved(resolvedConfig) {
        config = resolvedConfig;
      },
      closeBundle: {
        sequential: true,
        handler() {
          invariant(config, 'Vite config not resolved');
          const html = fs.readFileSync(
            path.join(config.build.outDir, 'iframe.html'),
            'utf8',
          );
          const swFilename = path.join(config.build.outDir, 'sw.js');
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
};

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
  const apiServerEnabled =
    env.VITE_DISABLE_REFERENCE_API_SERVER !== 'true' && cloudEnabled;

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
        project: path.join(dirname, 'project.inlang'),
        outdir: path.join(dirname, 'src/generated/paraglide'),
        strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
        emitTsDeclarations: true,
      }),
      TanStackRouterVite(),
      react(),
      tailwindcss(),
      serviceWorker(),
      serveTemplates(),
      serveCli(),
      installedExtensions(),
      ...(apiServerEnabled
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
    server: {
      host: true,
      port: env.VITE_DEV_SERVER_PORT ? +env.VITE_DEV_SERVER_PORT : undefined,
      https: env.VITE_DEV_SERVER_HTTPS
        ? {
            key: fs.readFileSync(path.join(secretsDir, 'certs/privkey.pem')),
            cert: fs.readFileSync(path.join(secretsDir, 'certs/fullchain.pem')),
          }
        : undefined,
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
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
