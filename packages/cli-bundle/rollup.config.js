import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import alias from '@rollup/plugin-alias';
import commonjs from '@rollup/plugin-commonjs';
import inject from '@rollup/plugin-inject';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import { nodeExternalModules } from '@vivliostyle/cli/node-modules';
import stdLibBrowser from 'node-stdlib-browser';
import { packageDirectorySync } from 'pkg-dir';
import { defineConfig } from 'rollup';
import dts from 'rollup-plugin-dts';
import { visualizer } from 'rollup-plugin-visualizer';

const require = createRequire(import.meta.url);

const resolvePkgDir = (cwd) => {
  let root = cwd;
  let name;
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
  if (!name) {
    return null;
  }
  return { root, name };
};

const workerConfig = defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    inlineDynamicImports: true,
  },
  external: [
    ...nodeExternalModules,
    'fsevents',
    /^tsx\//,
    'lightningcss',
    'jiti',
  ],
  plugins: [
    alias({
      entries: [
        // https://github.com/nodejs/readable-stream/issues/540
        // https://github.com/nodejs/readable-stream/commit/b733ae549e674b639a2528ddfd5394b6b8bb9bb4
        {
          find: 'process/',
          replacement: path.resolve(
            fileURLToPath(import.meta.url),
            '../src/stubs/node/process',
          ),
        },
        ...Object.entries({
          ...stdLibBrowser,
          ...Object.fromEntries(
            [
              'child_process',
              'crypto',
              'dns',
              'fs',
              'http',
              'module',
              'os',
              'path',
              'perf_hooks',
              'process',
              'util',
              'v8',
              'worker_threads',
            ].flatMap((alias) => {
              const replacement = path.resolve(
                fileURLToPath(import.meta.url),
                '../src/stubs/node',
                alias,
              );
              return [
                [alias, replacement],
                [`node:${alias}`, replacement],
              ];
            }),
          ),
        }).map(([key, value]) => ({
          find: key,
          replacement: value,
        })),
        {
          find: 'esbuild',
          replacement: 'esbuild-wasm/lib/browser.js',
        },
        {
          find: 'upath',
          replacement: stdLibBrowser.path,
        },
        {
          find: 'graceful-fs',
          replacement: path.resolve(
            fileURLToPath(import.meta.url),
            '../src/stubs/node/fs',
          ),
        },
        {
          find: 'terminal-link',
          replacement: path.resolve(
            fileURLToPath(import.meta.url),
            '../src/stubs/terminal-link',
          ),
        },
        {
          find: '@npmcli/arborist',
          replacement: path.resolve(
            fileURLToPath(import.meta.url),
            '../src/stubs/@npmcli/arborist',
          ),
        },
      ],
    }),
    commonjs(),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),
    json(),
    inject({
      process: path.resolve(
        fileURLToPath(import.meta.url),
        '../src/stubs/node/process.ts',
      ),
      Buffer: [stdLibBrowser.buffer, 'Buffer'],
      setImmediate: ['process', 'nextTick'],
    }),
    replace({
      values: {
        'require.resolve': 'null',
        __volume__: (() => {
          const volume = Object.fromEntries(
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
              const root = path.dirname(
                require.resolve(`${name}/package.json`),
              );
              return files.map((file) => [
                `/workdir/node_modules/${name}/${file}`,
                fs.readFileSync(path.join(root, file), 'utf8'),
              ]);
            }),
          );
          return JSON.stringify(volume);
        })(),
        __nodeVersion__: JSON.stringify('22.13.0'),
      },
      preventAssignment: true,
    }),
    typescript(),
    visualizer(),
    {
      name: 'resolve-import-meta',
      resolveImportMeta(property, { moduleId }) {
        if (property === 'url') {
          const { root, name } = resolvePkgDir(moduleId) ?? {};
          if (!name) {
            return null;
          }
          return JSON.stringify(
            pathToFileURL(
              path.join(
                '/workdir/node_modules',
                name,
                path.relative(root, moduleId),
              ),
            ).href,
          );
        }
        if (property === 'env') {
          return JSON.stringify({});
        }
        // https://github.com/vitejs/vite/blob/0b17ab3727202b8c87cb0e747c192e3527a5e1ee/packages/vite/src/node/server/ws.ts#L27
        if (property === 'require') {
          return '(() => ({}))';
        }
        return null;
      },
    },
    {
      name: 'resolve-rollup-browser-wasm',
      resolveId(id) {
        if (id === '#rollup-wasm-bindings') {
          return path.resolve(
            fileURLToPath(import.meta.url),
            '../src/stubs/rollup/wasm/bindings_wasm.js',
          );
        }
        return null;
      },
      load(id) {
        if (/\/rollup\/dist\/native.js/.test(id)) {
          return {
            code: `const {
  parse,
  xxhashBase64Url,
  xxhashBase36,
  xxhashBase16
} = require('#rollup-wasm-bindings');

exports.parse = parse;
exports.parseAsync = async (code, allowReturnOutsideFunction, _signal) =>
  parse(code, allowReturnOutsideFunction);
exports.xxhashBase64Url = xxhashBase64Url;
exports.xxhashBase36 = xxhashBase36;
exports.xxhashBase16 = xxhashBase16;
`,
          };
        }
        return null;
      },
    },
    {
      name: 'copy-wasm-file',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'esbuild.wasm',
          source: fs.readFileSync(require.resolve('esbuild-wasm/esbuild.wasm')),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'bindings_wasm_bg.wasm',
          source: fs.readFileSync(
            path.join(
              fileURLToPath(import.meta.url),
              '../src/stubs/rollup/wasm/bindings_wasm_bg.wasm',
            ),
          ),
        });
      },
    },
  ],
});

const dtsConfig = defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.d.ts',
    format: 'es',
  },
  plugins: [dts()],
});

const clientConfig = defineConfig({
  input: ['src/client/vite-client.ts', 'src/client/custom-hmr.ts'],
  output: {
    dir: 'dist/client',
  },
  plugins: [
    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),
    typescript(),
    {
      name: 'resolve-vite-client',
      resolveId(id) {
        if (id.startsWith('@vite/')) {
          return id;
        }
      },
      load(id) {
        if (id.startsWith('@vite/')) {
          const code = fs.readFileSync(
            path.resolve(
              require.resolve('vite/package.json'),
              '../dist/client',
              `${id.replace(/^@vite\//, '')}.mjs`,
            ),
            'utf8',
          );

          // https://github.com/vitejs/vite/blob/HEAD/packages/vite/src/node/plugins/clientInjections.ts
          function escapeReplacement(value) {
            const jsonValue = JSON.stringify(value);
            return () => jsonValue;
          }
          return code
            .replace(/__DEFINES__/g, escapeReplacement({}))
            .replace(`__MODE__`, escapeReplacement('development'))
            .replace(/__BASE__/g, escapeReplacement('/'))
            .replace(`__SERVER_HOST__`, escapeReplacement('localhost:5173/'))
            .replace(`__HMR_PROTOCOL__`, escapeReplacement(null))
            .replace(`__HMR_HOSTNAME__`, escapeReplacement(null))
            .replace(`__HMR_PORT__`, escapeReplacement(null))
            .replace(
              `__HMR_DIRECT_TARGET__`,
              escapeReplacement('localhost:5173/'),
            )
            .replace(`__HMR_BASE__`, escapeReplacement('/'))
            .replace(`__HMR_TIMEOUT__`, escapeReplacement(30000))
            .replace(`__HMR_ENABLE_OVERLAY__`, escapeReplacement(true))
            .replace(`__HMR_CONFIG_NAME__`, escapeReplacement('vite.config.ts'))
            .replace(`__WS_TOKEN__`, escapeReplacement('dummy'));
        }
      },
    },
  ],
});

export default defineConfig([workerConfig, dtsConfig, clientConfig]);
