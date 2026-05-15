import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nodeExternalModules } from '@vivliostyle/cli/node-modules';
import MagicString from 'magic-string';
import { packageDirectorySync } from 'pkg-dir';
import { defineConfig, type Plugin } from 'rolldown';
import { parseAst } from 'rolldown/parseAst';
import { dts } from 'rolldown-plugin-dts';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineEnv } from 'unenv';

const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const resolvePkgDir = (cwd: string): { root: string; name: string } | null => {
  let root: string | undefined = cwd;
  let name: string | undefined;
  while (root) {
    root = packageDirectorySync({ cwd: root });
    if (!root || !fs.existsSync(path.join(root, 'package.json'))) {
      continue;
    }
    name = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ).name;
    if (name) {
      break;
    }
    root = path.dirname(root);
  }
  if (!root || !name) {
    return null;
  }
  return { root, name };
};

const buildVolume = () =>
  Object.fromEntries(
    Object.entries({
      vite: {
        files: [
          'package.json',
          'dist/client/client.mjs',
          'dist/client/env.mjs',
        ],
      },
      '@vivliostyle/cli': {
        files: ['package.json'],
      },
      '@vivliostyle/viewer': {
        files: ['package.json', 'lib/index.html'],
      },
    }).flatMap(([name, { files }]) => {
      const root = path.dirname(require.resolve(`${name}/package.json`));
      return files.map((file) => [
        `/workdir/node_modules/${name}/${file}`,
        fs.readFileSync(path.join(root, file), 'utf8'),
      ]);
    }),
  );

const stubPath = (segment: string) =>
  path.resolve(__dirname, 'src/stubs/node', segment);

const rolldownBrowserDir = path.dirname(
  require.resolve('@rolldown/browser/package.json'),
);

// Base alias map from unenv: every Node builtin (`node:fs` / `fs` / etc.) maps
// to a `unenv/node/*` polyfill that prefers Web standards (Web Crypto, Web
// Streams, Web Worker) and falls back to `notImplemented` (lazy throw) for
// fundamentally non-browser APIs. We layer specific overrides on top below
// where we need different behavior than unenv ships.
const { env: unenvEnv } = defineEnv({
  nodeCompat: true,
  // unenv's npmShims rewrite `whatwg-url`/`node-fetch`/`debug`/... to
  // thin wrappers. jsdom (bundled inside @vivliostyle/cli) hard-depends on
  // whatwg-url's `install` method, which the shim doesn't expose — keep the
  // real packages.
  npmShims: false,
  resolve: true,
});

const aliasOverrides = Object.fromEntries(
  // Modules where unenv's polyfill isn't sufficient for our worker:
  // - module: vite calls `createRequire(import.meta.url)("crypto")` synchronously;
  //   unenv's createRequire is `notImplemented`. Phase 2's builtinMap-backed
  //   stub is required.
  // - crypto: unenv stubs `createHash`/`hash` as `notImplemented`. We override
  //   with a hash-wasm-backed sync implementation.
  // - fs: the cli-bundle worker is memfs-backed by design; unenv's in-memory fs
  //   would overwrite that.
  // - worker_threads: unenv's `Worker` class is a EventEmitter stub with
  //   no-op `postMessage`. We need real `globalThis.Worker` for `@rolldown/browser`'s
  //   WASI worker pool.
  // - child_process: unenv throws on call; we keep a silent noop because some
  //   vivliostyle/cli code statically references these but never invokes them.
  // - util: unenv ships most APIs but `parseEnv` and `stripVTControlCharacters`
  //   are `notImplemented`. We re-export unenv and override those two.
  // - buffer: unenv's `isUtf8` is `notImplemented`; we keep a real implementation.
  // - stream: unenv's `Stream`/`PassThrough`/`pipeline`/`finished` etc. are
  //   `notImplemented`. vite's bundled `ws` and memfs use them, so route to the
  //   readable-stream package directly.
  [
    'module',
    'crypto',
    'fs',
    'http',
    'worker_threads',
    'child_process',
    'util',
    'buffer',
  ].flatMap((name) => [
    [name, stubPath(name)],
    [`node:${name}`, stubPath(name)],
  ]),
);

const aliasMap: Record<string, string> = {
  ...unenvEnv.alias,
  ...aliasOverrides,
  // memfs lives behind `fs.ts`; route the `fs/promises` subpath to memfs too
  // so callers using `import * as fsp from 'fs/promises'` see the same vfs.
  'fs/promises': path.resolve(stubPath('fs'), 'promises'),
  'node:fs/promises': path.resolve(stubPath('fs'), 'promises'),
  stream: require.resolve('readable-stream/lib/stream'),
  'node:stream': require.resolve('readable-stream/lib/stream'),
  // unenv ships a class-based EventEmitter, but readable-stream calls
  // `Stream.call(this)` (prototype-style super-init) on it. Use the npm
  // `events` polyfill instead — it's a function-based EventEmitter that
  // accepts both `new` and `.call(this)`.
  events: require.resolve('events/'),
  'node:events': require.resolve('events/'),
  // unenv's npm shim wraps `inherits` as `{ default: fn }`. The bundled
  // readable-stream code (CJS) expects `require('inherits')` to be the
  // function itself, so route to the original CJS package.
  inherits: require.resolve('inherits/inherits_browser.js'),
  // unenv's zlib is mostly notImplemented; vivliostyle/cli's EPUB packing
  // path needs real createGzip/Inflate. Use the small browserify-zlib polyfill.
  zlib: require.resolve('browserify-zlib'),
  'node:zlib': require.resolve('browserify-zlib'),
  // unenv ships `notImplemented` for `string_decoder.StringDecoder`; the npm
  // package implements it natively for browsers.
  string_decoder: require.resolve('string_decoder'),
  'node:string_decoder': require.resolve('string_decoder'),
  // https://github.com/nodejs/readable-stream/issues/540
  'process/': unenvEnv.alias.process,
  upath: unenvEnv.alias.path,
  'graceful-fs': stubPath('fs'),
  'terminal-link': path.resolve(__dirname, 'src/stubs/terminal-link'),
  '@npmcli/arborist': path.resolve(__dirname, 'src/stubs/@npmcli/arborist'),
  tinyexec: path.resolve(__dirname, 'src/stubs/tinyexec'),
};

// Vite 8 imports `rolldown` and its subpaths internally for prebundle/build.
// Redirect them to the `@rolldown/browser` files, which ship a WASM-backed
// binding so the worker can run rolldown without a native node module.
// We return absolute paths so the resolver doesn't try to re-resolve a bare
// specifier (which would fail for `./utils` etc. since `@rolldown/browser`
// doesn't expose those subpath exports). The `*.browser.mjs` variants are
// the right entry points for the worker bundle.
const rolldownToBrowserMap: Record<string, string> = {
  rolldown: path.join(rolldownBrowserDir, 'dist/index.browser.mjs'),
  'rolldown/parseAst': path.join(
    rolldownBrowserDir,
    'dist/parse-ast-index.mjs',
  ),
  'rolldown/filter': path.join(rolldownBrowserDir, 'dist/filter-index.mjs'),
  'rolldown/plugins': path.join(
    rolldownBrowserDir,
    'dist/plugins-index.browser.mjs',
  ),
  'rolldown/experimental': path.join(
    rolldownBrowserDir,
    'dist/experimental-index.browser.mjs',
  ),
  'rolldown/utils': path.join(
    rolldownBrowserDir,
    'dist/utils-index.browser.mjs',
  ),
};

const redirectRolldownToBrowserPlugin: Plugin = {
  name: 'redirect-rolldown-to-browser',
  resolveId(id) {
    if (rolldownToBrowserMap[id]) {
      return rolldownToBrowserMap[id];
    }
    // `dist/parse-ast-index.mjs`, `dist/filter-index.mjs`, and other non-browser
    // subpath entries pull in `dist/shared/*.mjs` files that import the Node
    // CommonJS binding (`rolldown-binding.wasi.cjs`). At runtime in a browser
    // worker that file would call `require('node:wasi')` and crash. Redirect
    // it to the WASM-backed browser binding, which exposes the same NAPI
    // symbols.
    if (id.endsWith('rolldown-binding.wasi.cjs')) {
      return path.join(
        rolldownBrowserDir,
        'dist/rolldown-binding.wasi-browser.js',
      );
    }
    return null;
  },
};

// Replaces `import.meta.url` / `.env` / `.require` MemberExpression AST nodes.
// We can't use a regex over the source: vite's bundled code contains the literal
// string "import.meta.url" inside a template literal it emits, and naive text
// replacement breaks that string. Walking the oxc AST avoids string contexts.
const resolveImportMetaPlugin: Plugin = {
  name: 'resolve-import-meta',
  transform: {
    filter: { id: /\.(?:js|mjs|cjs|ts|tsx)$/ },
    handler(code, id) {
      if (!/import\.meta\.(?:url|env|require)\b/.test(code)) return null;
      const pkg = resolvePkgDir(id);
      if (!pkg) return null;
      const { root, name } = pkg;
      const virtualUrl = JSON.stringify(
        pathToFileURL(
          path.join('/workdir/node_modules', name, path.relative(root, id)),
        ).href,
      );

      let program: ReturnType<typeof parseAst>;
      try {
        program = parseAst(code, { lang: 'ts' }, id);
      } catch {
        return null;
      }

      type Replacement = { start: number; end: number; value: string };
      // biome-ignore lint/suspicious/noExplicitAny: oxc AST nodes are unions
      const matchImportMeta = (node: any): Replacement | null => {
        if (node?.type !== 'MemberExpression') return null;
        if (node.object?.type !== 'MetaProperty') return null;
        if (node.object.meta?.name !== 'import') return null;
        if (node.object.property?.name !== 'meta') return null;
        if (typeof node.start !== 'number' || typeof node.end !== 'number') {
          return null;
        }
        const value =
          node.property?.name === 'url'
            ? virtualUrl
            : node.property?.name === 'env'
              ? '({})'
              : // https://github.com/vitejs/vite/blob/0b17ab3727202b8c87cb0e747c192e3527a5e1ee/packages/vite/src/node/server/ws.ts#L27
                node.property?.name === 'require'
                ? '(() => ({}))'
                : null;
        if (value === null) return null;
        return { start: node.start, end: node.end, value };
      };
      const replacements: Replacement[] = [];
      const visit = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const replacement = matchImportMeta(node);
        if (replacement) {
          replacements.push(replacement);
          return;
        }
        for (const key of Object.keys(node)) {
          if (key === 'parent') continue;
          const child = (node as Record<string, unknown>)[key];
          if (Array.isArray(child)) {
            for (const item of child) visit(item);
          } else if (child && typeof child === 'object') {
            visit(child);
          }
        }
      };
      visit(program);

      if (replacements.length === 0) return null;
      const ms = new MagicString(code);
      for (const { start, end, value } of replacements) {
        ms.overwrite(start, end, value);
      }
      return { code: ms.toString(), map: ms.generateMap({ hires: true }) };
    },
  },
};

// emnapi (used by `@rolldown/browser`'s WASM binding) detects "Node-vs-browser"
// by reading `process.versions.node` and then drives Workers via Node's
// `worker.on(...)` API, which doesn't exist on browser Workers. We can't just
// hide `process.versions.node` because vite's bundled `chunks/node.js` calls
// `.split(".")` on it. Force the env flag false in the emnapi files so the
// browser code path always wins.
//
// The flag is defined twice in `@emnapi/core/dist/emnapi-core.js` (top-level
// and inside `createNapiModule`) and once in `@emnapi/wasi-threads/dist/
// wasi-threads.js`; all three sites match the same regex. The Node-only
// branch we want to skip is the cluster of `worker.on('message' | 'error' |
// 'detachedExit', …)` and `worker.ref()/unref()` calls in thread-manager.ts,
// which crash on a browser `Worker` produced by `globalThis.Worker`.
//
// Upstream sources (the dist files are bundled from these):
//   https://github.com/toyobayashi/emnapi/blob/main/packages/wasi-threads/src/util.ts
//     — defines `ENVIRONMENT_IS_NODE`
//   https://github.com/toyobayashi/emnapi/blob/main/packages/wasi-threads/src/thread-manager.ts
//     — the `if (ENVIRONMENT_IS_NODE)` blocks we need to skip
const patchEmnapiEnvDetectionPlugin: Plugin = {
  name: 'patch-emnapi-env-detection',
  transform: {
    filter: { id: /[\\/]@emnapi[\\/](?:core|wasi-threads)[\\/]dist[\\/]/ },
    handler(code) {
      return code.replace(
        /var\s+ENVIRONMENT_IS_NODE\s*=\s*typeof process[\s\S]*?process\.versions\.node\s*===\s*['"]string['"];/g,
        'var ENVIRONMENT_IS_NODE = false;',
      );
    },
  },
};

// `@rolldown/browser/dist/rolldown-binding.wasi-browser.js` self-loads the WASM
// and spawns its WASI worker via `import.meta.url`. Once we bundle the file,
// the resolved virtual URL (filled in by `resolveImportMetaPlugin`) points at
// `file:///workdir/...` and `fetch` rejects it. Patch the two URL constructions
// before the import-meta pass runs so the bundled binding fetches our copies
// served from `/_cli/`. Resolve against `self.location.href` so the URL is
// absolute even when the worker was spawned from a blob: URL (the relative
// form fails URL parsing because `blob:` has no path-absolute base).
//
// The two patched lines correspond to `__wasmUrl` and the `onCreateWorker()`
// `new Worker(...)` call in the npm artifact (lines 20 and 41 of the
// generated file at the time of writing). The artifact is emitted by
// `napi build` from these template strings:
//   https://github.com/napi-rs/napi-rs/blob/main/cli/src/api/templates/load-wasi-template.ts
//     — emits `*.wasi-browser.js`, including the two `new URL(..., import.meta.url)` calls
//   https://github.com/napi-rs/napi-rs/blob/main/cli/src/api/templates/wasi-worker-template.ts
//     — emits `wasi-worker-browser.mjs` (the worker entry the second URL points at)
const patchRolldownBindingPlugin: Plugin = {
  name: 'patch-rolldown-binding',
  transform: {
    filter: { id: /[\\/]rolldown-binding\.wasi-browser\.js$/ },
    handler(code) {
      return code
        .replace(
          /new URL\(['"]\.\/rolldown-binding\.wasm32-wasi\.wasm['"], import\.meta\.url\)\.href/,
          'new URL("/_cli/rolldown-binding.wasm32-wasi.wasm", self.location.href).href',
        )
        .replace(
          /new URL\(['"]\.\/wasi-worker-browser\.mjs['"], import\.meta\.url\)/,
          'new URL("/_cli/rolldown-wasi-worker.js", self.location.href)',
        );
    },
  },
};

const copyWasmFilePlugin: Plugin = {
  name: 'copy-wasm-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'rolldown-binding.wasm32-wasi.wasm',
      source: fs.readFileSync(
        path.join(rolldownBrowserDir, 'dist/rolldown-binding.wasm32-wasi.wasm'),
      ),
    });
  },
};

const resolveViteClientPlugin: Plugin = {
  name: 'resolve-vite-client',
  resolveId(id) {
    if (id.startsWith('@vite/')) {
      return id;
    }
    return null;
  },
  load(id) {
    if (!id.startsWith('@vite/')) return null;
    const code = fs.readFileSync(
      path.resolve(
        require.resolve('vite/package.json'),
        '../dist/client',
        `${id.replace(/^@vite\//, '')}.mjs`,
      ),
      'utf8',
    );

    // https://github.com/vitejs/vite/blob/HEAD/packages/vite/src/node/plugins/clientInjections.ts
    const escapeReplacement = (value: unknown) => {
      const jsonValue = JSON.stringify(value);
      return () => jsonValue;
    };
    return code
      .replace(/__DEFINES__/g, escapeReplacement({}))
      .replace(`__MODE__`, escapeReplacement('development'))
      .replace(/__BASE__/g, escapeReplacement('/'))
      .replace(`__SERVER_HOST__`, escapeReplacement('localhost:5173/'))
      .replace(`__HMR_PROTOCOL__`, escapeReplacement(null))
      .replace(`__HMR_HOSTNAME__`, escapeReplacement(null))
      .replace(`__HMR_PORT__`, escapeReplacement(null))
      .replace(`__HMR_DIRECT_TARGET__`, escapeReplacement('localhost:5173/'))
      .replace(`__HMR_BASE__`, escapeReplacement('/'))
      .replace(`__HMR_TIMEOUT__`, escapeReplacement(30000))
      .replace(`__HMR_ENABLE_OVERLAY__`, escapeReplacement(true))
      .replace(`__HMR_CONFIG_NAME__`, escapeReplacement('vite.config.ts'))
      .replace(`__WS_TOKEN__`, escapeReplacement('dummy'))
      .replace(`__SERVER_FORWARD_CONSOLE__`, escapeReplacement(false))
      .replaceAll(`__BUNDLED_DEV__`, escapeReplacement(false));
  },
};

const workerConfig = defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'es',
    inlineDynamicImports: true,
  },
  external: [
    ...nodeExternalModules,
    'fsevents',
    /^tsx\//,
    'lightningcss',
    'jiti',
  ],
  platform: 'browser',
  resolve: {
    alias: aliasMap,
  },
  transform: {
    inject: {
      // unenv's preset injects `process` (unenv/node/process), `Buffer`
      // (node:buffer's Buffer), `setImmediate`/`clearImmediate` (node:timers),
      // and `global` (unenv/polyfill/globalthis). The aliases above route
      // those bare-builtin imports through our overrides where applicable.
      ...unenvEnv.inject,
      // We need our own globalThis stub on top of unenv's so that
      // `setTimeout(...).unref()` calls (vite 8) get a Node-shaped Timeout.
      globalThis: path.resolve(__dirname, 'src/stubs/global-this.ts'),
    },
    define: {
      'require.resolve': 'null',
      // Some Node-targeted shims still reference the bare identifier `global`.
      // Browser workers don't expose it, so map it onto `globalThis`; the
      // `inject` pass above then routes `globalThis` through our stub.
      global: 'globalThis',
      __volume__: JSON.stringify(buildVolume()),
    },
  },
  plugins: [
    // Order matters: patch out the import-meta-based URLs in
    // rolldown-binding.wasi-browser.js *before* `resolveImportMetaPlugin`
    // rewrites the same expression into a virtual file:// URL.
    patchRolldownBindingPlugin,
    patchEmnapiEnvDetectionPlugin,
    redirectRolldownToBrowserPlugin,
    resolveImportMetaPlugin,
    copyWasmFilePlugin,
    visualizer() as Plugin,
  ],
});

const rolldownWorkerConfig = defineConfig({
  input: path.join(rolldownBrowserDir, 'dist/wasi-worker-browser.mjs'),
  output: {
    file: 'dist/rolldown-wasi-worker.js',
    format: 'es',
    inlineDynamicImports: true,
  },
  platform: 'browser',
  plugins: [patchEmnapiEnvDetectionPlugin],
});

const dtsConfig = defineConfig({
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'es',
  },
  external: [
    ...nodeExternalModules,
    'fsevents',
    /^tsx\//,
    'lightningcss',
    'jiti',
    // keep all third-party type imports as-is so the dts bundler doesn't try
    // to inline (and re-validate) every dependency's .d.ts files
    /^[^./]/,
  ],
  plugins: [
    dts({
      emitDtsOnly: true,
      compilerOptions: { verbatimModuleSyntax: false },
    }),
  ],
});

const clientConfig = defineConfig({
  input: [
    'src/client/vite-client.ts',
    'src/client/custom-hmr.ts',
    'src/client/viewer-adapter.ts',
  ],
  output: {
    dir: 'dist/client',
    format: 'es',
  },
  platform: 'browser',
  plugins: [resolveViteClientPlugin],
});

export default defineConfig([
  workerConfig,
  dtsConfig,
  clientConfig,
  rolldownWorkerConfig,
]);
