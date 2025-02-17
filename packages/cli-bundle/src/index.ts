import './volume';

import { EventEmitter } from 'node:events';
import { createVitePlugin, build as vivliostyleBuild } from '@vivliostyle/cli';
import * as Comlink from 'comlink';
import connect from 'connect';
import { initialize } from 'esbuild-wasm/lib/browser.js';
import { type Zippable, type ZippableFile, zipSync } from 'fflate';
import { fs } from 'memfs';
import { toTreeSync } from 'memfs/lib/print';
import { toSnapshotSync } from 'memfs/lib/snapshot';
import {
  type MockResponse,
  type RequestMethod,
  createRequest,
  createResponse,
} from 'node-mocks-http';
import { type ViteDevServer, createServer, build as viteBuild } from 'vite';
import initRollup from '#rollup-wasm-bindings';

const commonHeaders = {
  'cache-control': 'no-store',
  'cross-origin-embedder-policy': 'credentialless',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'cross-origin',
};

let server: ViteDevServer;

async function setupServer() {
  await Promise.all([
    initialize({ wasmURL: 'esbuild.wasm' }),
    initRollup({ module_or_path: 'bindings_wasm_bg.wasm' }),
  ]);
  server = await createServer({
    root: '/workdir',
    appType: 'custom',
    server: {
      middlewareMode: true,
    },
    plugins: [
      createVitePlugin({
        cwd: '/workdir',
        logLevel: 'info',
      }),
    ],
  });
  console.log(toTreeSync(fs));
}

function zipDirectory(pwd: string) {
  const out = toSnapshotSync({ fs, path: pwd });
  function toZippable(
    snapshot: typeof out,
    path = '.',
  ): ZippableFile | undefined {
    if (!snapshot) {
      return;
    }
    switch (snapshot[0]) {
      case 0 /* Folder */: {
        const [, , entries] = snapshot;
        return Object.fromEntries(
          Object.entries(entries).flatMap(([name, entry]) => {
            const value = toZippable(
              entry,
              [path, name].filter(Boolean).join('/'),
            );
            return value ? [[name, value]] : [];
          }),
        );
      }
      case 1 /* File */: {
        const [, , data] = snapshot;
        return data;
      }
    }
  }
  const files = toZippable(out);
  if (!files) {
    return;
  }
  const zip = zipSync(files as Zippable);
  return zip;
}

async function serve(
  ...[request, init]: ConstructorParameters<typeof Request>
) {
  if (!server) {
    throw new Error('Server is not ready');
  }
  const url = request as Exclude<RequestInfo, Request>;
  const headers = init?.headers as Exclude<HeadersInit, Headers>;
  const method = init?.method;
  const body = init?.body as Extract<BodyInit, string | ArrayBuffer>;

  return await new Promise<ConstructorParameters<typeof Response>>(
    (resolve, reject) => {
      const req = createRequest({
        url: new URL(url).pathname,
        headers: Array.isArray(headers) ? Object.fromEntries(headers) : headers,
        method: method as RequestMethod,
        // body, // TODO
      });
      const res = createResponse({
        eventEmitter: EventEmitter,
        writableStream: globalThis.WritableStream,
      });
      res.on('end', () => {
        const response: MockResponse<Response> = res;
        resolve([
          response._getData(),
          {
            headers: {
              ...(response._getHeaders() as Record<string, string>),
              ...commonHeaders,
            },
            status: response._getStatusCode(),
            statusText: response._getStatusMessage(),
          },
        ]);
      });
      connect()
        .use(server.middlewares)
        .handle(req, res, (err: unknown) => {
          if (err) {
            return reject(err);
          }
          resolve([
            null,
            {
              headers: { ...commonHeaders },
              status: 404,
              statusText: 'Not Found',
            },
          ]);
        });
    },
  );
}

async function build() {
  if (!server) {
    throw new Error('Server is not ready');
  }
  await vivliostyleBuild({
    cwd: '/workdir',
    logLevel: 'info',
    output: 'dist',
  });
  return zipDirectory('/workdir/dist');
}

async function debug() {
  return zipDirectory('/');
}

self.addEventListener('message', async (event) => {
  if (event.data.command === 'connect') {
    const port = event.ports[0];
    const channel = new BroadcastChannel('vs-cli');
    Comlink.expose({ serve, build, debug }, channel);
    await setupServer();

    const sw = Comlink.wrap<{ ready: () => void }>(port);
    sw.ready();
  }
});
