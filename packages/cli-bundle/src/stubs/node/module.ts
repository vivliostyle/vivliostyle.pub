import * as nodeAssert from 'node:assert';
import * as buffer from 'node:buffer';
import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as dns from 'node:dns';
import fs, * as nodeFs from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import path, * as nodePath from 'node:path';
import * as perfHooks from 'node:perf_hooks';
import * as nodeProcess from 'node:process';
import * as stream from 'node:stream';
import * as util from 'node:util';
import * as v8 from 'node:v8';
import * as workerThreads from 'node:worker_threads';
import * as zlib from 'node:zlib';
// `events`, `https`, `net`, `tls`, and `url` come in via node-stdlib-browser
// aliases keyed on the bare specifier (no `node:` prefix), so importing them
// as `'node:events'` etc. would bypass the alias and try to resolve the real
// builtin — which doesn't exist in the worker bundle.
// biome-ignore lint/style/useNodejsImportProtocol: bare specifier required for the alias map to match
import * as events from 'events';
// biome-ignore lint/style/useNodejsImportProtocol: bare specifier required for the alias map to match
import * as https from 'https';
// biome-ignore lint/style/useNodejsImportProtocol: bare specifier required for the alias map to match
import * as net from 'net';
import picomatch from 'picomatch';
// biome-ignore lint/style/useNodejsImportProtocol: bare specifier required for the alias map to match
import * as tls from 'tls';
// biome-ignore lint/style/useNodejsImportProtocol: bare specifier required for the alias map to match
import * as url from 'url';

// Vite 8's bundled `chunks/node.js` keeps `createRequire(import.meta.url)` at
// module init and stores the result as a top-level `__require` it later uses
// to pull in node builtins (`__require("crypto")`, etc.). In Node that works
// through the real module registry; in our browser worker bundle it lands on
// this stub. Eagerly collect the same node-builtin stubs we already alias at
// build time and serve them by name. Unknown ids throw `MODULE_NOT_FOUND` —
// matches Node's CJS semantics, which a number of callers (chokidar's
// `try { require('fsevents') }`, ws' `bufferutil` lookup, etc.) rely on to
// fall back to a non-native code path.
// `module` self-references this file via a getter so the const initializer
// can reach the `moduleSelfExport` declared further down without a TDZ trip.
const builtinMap: Record<string, unknown> = {
  assert: nodeAssert,
  buffer,
  child_process: childProcess,
  crypto,
  dns,
  events,
  fs: nodeFs,
  'fs/promises': nodeFsPromises,
  http,
  https,
  get module() {
    return moduleSelfExport;
  },
  net,
  os,
  path: nodePath,
  perf_hooks: perfHooks,
  process: nodeProcess,
  stream,
  tls,
  url,
  util,
  v8,
  worker_threads: workerThreads,
  zlib,
};

// Non-builtin packages whose CJS sources go through the same `__require` path.
// Treated separately from builtinMap so `isBuiltin()` / `builtinModules` keep
// reflecting the Node builtin set.
const npmModuleMap: Record<string, unknown> = {
  // vite 8's bundled `chunks/node.js` ships chokidar / readdirp / anymatch as CJS
  // wrappers that call `__require("picomatch")` instead of inlining the picomatch
  // module reference. Without an entry here that lookup returns `{}`, breaking
  // `picomatch(matcher)` with TypeError. Import the real package so callers get
  // a callable function back.
  picomatch,
};

// Modules where returning `{}` (instead of the default `MODULE_NOT_FOUND`
// throw) is the safe choice — usually because the caller treats the module as
// optional but does not wrap the require in try/catch. Add entries here only
// after confirming the caller tolerates an empty namespace.
const silentFallbackModules = new Set<string>([
  // vite reads `http2.constants` only when wiring an explicit HTTPS+H2 dev
  // server. Our worker uses `middlewareMode: true` so the H2 paths never run,
  // but the import is unconditional at module init. `{}` lets it pass.
  'http2',
]);

const browserRequire = (id: string): unknown => {
  const key = id.startsWith('node:') ? id.slice(5) : id;
  const mod = builtinMap[key] ?? npmModuleMap[key];
  if (mod !== undefined) {
    // CJS callers expect `require('events')` to return the EventEmitter class
    // and `require('crypto').randomBytes` to be a function. Our `import * as`
    // namespaces wrap those as `{ default, ...named }`, so `class X extends
    // require('events')` would fail because the namespace isn't a constructor.
    // Hand back the `default` export when present — it carries the original
    // CJS shape — and fall through to the namespace for ES-only modules.
    const defaultExport = (mod as { default?: unknown }).default;
    return defaultExport !== undefined ? defaultExport : mod;
  }
  if (silentFallbackModules.has(key)) {
    return {};
  }
  const err = new Error(`Cannot find module '${id}'`) as Error & {
    code?: string;
  };
  err.code = 'MODULE_NOT_FOUND';
  throw err;
};

export const builtinModules = Object.keys(builtinMap);
export const createRequire = () => browserRequire;
export const isBuiltin = (id: string) =>
  builtinModules.includes(id.startsWith('node:') ? id.slice(5) : id);

export const _nodeModulePaths = (from: string) => {
  const paths = [];
  let currentPath = path.resolve(from);
  while (currentPath !== path.parse(currentPath).root) {
    paths.push(path.join(currentPath, 'node_modules'));
    currentPath = path.dirname(currentPath);
  }
  return paths;
};

export const _resolveFilename = (
  request: string,
  parent: { paths: string[] },
): string => {
  const paths = parent.paths || [];
  for (const basePath of paths) {
    const fullPath = path.join(basePath, request);
    for (const ext of ['', '.js', '.json', '.node']) {
      if (fs.existsSync(`${fullPath}${ext}`)) {
        return `${fullPath}${ext}`;
      }
    }
  }
  throw new Error(`Cannot find module '${request}'`);
};

const moduleSelfExport = {
  builtinModules,
  createRequire,
  isBuiltin,
  _nodeModulePaths,
  _resolveFilename,
};

// Vite 8.1's config/SSR dependency tracker feature-detects `Module.registerHooks`
// / `Module.register` and silently no-ops when a runtime exposes neither (its
// documented fallback). Exposing the named `Module` without either hook keeps
// vite on that fallback path instead of trying to register a Node loader.
export const Module = moduleSelfExport;

export default moduleSelfExport;
