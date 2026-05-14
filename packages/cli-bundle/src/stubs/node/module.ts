import * as buffer from 'node:buffer';
import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as dns from 'node:dns';
import fs, * as nodeFs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import path, * as nodePath from 'node:path';
import * as perfHooks from 'node:perf_hooks';
import * as nodeProcess from 'node:process';
import * as stream from 'node:stream';
import * as util from 'node:util';
import * as v8 from 'node:v8';
import * as workerThreads from 'node:worker_threads';
// `events`, `https`, `net`, `tls`, and `url` come in via node-stdlib-browser
// aliases, not our own stubs, so import them via the bare-builtin name and
// the resolver picks them up from the alias map.
import * as events from 'events';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import * as url from 'url';

// Vite 8's bundled `chunks/node.js` keeps `createRequire(import.meta.url)` at
// module init and stores the result as a top-level `__require` it later uses
// to pull in node builtins (`__require("crypto")`, etc.). In Node that works
// through the real module registry; in our browser worker bundle it lands on
// this stub. Returning a noop made every `__require("…")` undefined, which
// broke `const { randomBytes } = …`-style destructures inside vite's bundled
// `ws`. Eagerly collect the same node-builtin stubs we already alias at build
// time and serve them by name; anything else returns an empty object so the
// caller at least has somewhere to destructure from.
const builtinMap: Record<string, unknown> = {
  buffer,
  child_process: childProcess,
  crypto,
  dns,
  events,
  fs: nodeFs,
  http,
  https,
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
};

const browserRequire = (id: string): unknown => {
  const key = id.startsWith('node:') ? id.slice(5) : id;
  const mod = builtinMap[key];
  if (mod === undefined) return {};
  // CJS callers expect `require('events')` to return the EventEmitter class
  // and `require('crypto').randomBytes` to be a function. Our `import * as`
  // namespaces wrap those as `{ default, ...named }`, so `class X extends
  // require('events')` would fail because the namespace isn't a constructor.
  // Hand back the `default` export when present — it carries the original
  // CJS shape — and fall through to the namespace for ES-only modules.
  const defaultExport = (mod as { default?: unknown }).default;
  return defaultExport !== undefined ? defaultExport : mod;
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

export default {
  builtinModules,
  createRequire,
  isBuiltin,
  _nodeModulePaths,
  _resolveFilename,
};
