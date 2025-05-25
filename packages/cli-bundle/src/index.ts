import './volume';

import { createVitePlugin, build as vivliostyleBuild } from '@vivliostyle/cli';
import connect from 'connect';
import { initialize } from 'esbuild-wasm/lib/browser.js';
import { fs, vol } from 'memfs';
import { toTreeSync } from 'memfs/lib/print';
import { toSnapshotSync } from 'memfs/lib/snapshot';
import type { MockResponse, RequestMethod } from 'node-mocks-http';
import { type HotPayload, type ViteDevServer, createServer } from 'vite';
import initRollup from '#rollup-wasm-bindings';
import { createMocks } from './http';
import { vsCustomHmrPlugin } from './vite-plugin';

const commonHeaders = {
  'cache-control': 'no-store',
  'cross-origin-embedder-policy': 'credentialless',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'cross-origin',
};

const hmrChannel = new BroadcastChannel('worker:vite-hmr');
function sendHotPayload(payload: HotPayload) {
  hmrChannel.postMessage(payload);
}

let server: ViteDevServer;

export async function setupServer() {
  await Promise.all([
    initialize({ wasmURL: '/@cli/esbuild.wasm' }),
    initRollup({ module_or_path: '/@cli/bindings_wasm_bg.wasm' }),
  ]);
  server = await createServer({
    root: '/workdir',
    appType: 'custom',
    server: {
      middlewareMode: true,
      allowedHosts: true,
    },
    plugins: [
      createVitePlugin({
        cwd: '/workdir',
        logLevel: 'info',
      }),
      vsCustomHmrPlugin({
        sendHotPayload,
      }),
    ],
  });
}

export function webSocketConnect() {
  sendHotPayload({ type: 'connected' });
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

export async function serve(
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
      const { req, res } = createMocks({
        url: new URL(url).pathname,
        headers: Array.isArray(headers) ? Object.fromEntries(headers) : headers,
        method: method as RequestMethod,
        // body, // TODO
      });
      res.on('end', () => {
        const response: MockResponse<Response> = res;
        const buffer = response._getBuffer();
        const body = buffer.length ? buffer : response._getData();
        resolve([
          body,
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

export async function build() {
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

export const read = (...args: Parameters<typeof fs.promises.readFile>) =>
  fs.promises.readFile(...args);
export const write = (...args: Parameters<typeof fs.promises.writeFile>) =>
  fs.promises.writeFile(...args);
export const fromJSON = (...args: Parameters<typeof vol.fromJSON>) =>
  vol.fromJSON(...args);
export const toJSON = (...args: Parameters<typeof vol.toJSON>) =>
  vol.toJSON(...args);

export const printTree = () => {
  console.log(toTreeSync(fs));
};
