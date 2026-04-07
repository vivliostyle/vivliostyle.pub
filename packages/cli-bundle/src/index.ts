import './volume';

import path from 'node:path';
import { createVitePlugin, build as vivliostyleBuild } from '@vivliostyle/cli';
import connect from 'connect';
import { initialize } from 'esbuild-wasm/lib/browser.js';
import { type Zippable, type ZippableFile, zipSync } from 'fflate';
import { fs, vol } from 'memfs';
import { toTreeSync } from 'memfs/lib/print';
import { toSnapshotSync } from 'memfs/lib/snapshot';
import type { MockResponse, RequestMethod } from 'node-mocks-http';
import { createServer, type HotPayload, type ViteDevServer } from 'vite';

// @ts-expect-error: Resolved by rollup plugin
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
    initialize({ wasmURL: '/_cli/esbuild.wasm' }),
    initRollup({ module_or_path: '/_cli/bindings_wasm_bg.wasm' }),
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
            if (
              path === '.' &&
              (name.startsWith('.') || name === 'node_modules')
            ) {
              return [];
            }
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
    throw new Error(`Failed to create zip: ${pwd}`);
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
  // TODO: Handle body
  // const body = init?.body as Extract<BodyInit, string | ArrayBuffer>;

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

export async function buildEpub() {
  if (!server) {
    throw new Error('Server is not ready');
  }
  await vivliostyleBuild({
    cwd: '/workdir',
    logLevel: 'info',
    output: '/out/dist.epub',
    disableServerStartup: true,
  });
  return fs.readFileSync('/out/dist.epub') as Uint8Array;
}

export async function buildWebPub() {
  if (!server) {
    throw new Error('Server is not ready');
  }
  await vivliostyleBuild({
    cwd: '/workdir',
    logLevel: 'info',
    output: '/out/dist',
    disableServerStartup: true,
  });
  return zipDirectory('/out/dist');
}

export async function exportProjectZip() {
  return zipDirectory('/workdir');
}

export const read = (...args: Parameters<typeof fs.promises.readFile>) =>
  fs.promises.readFile(...args);
export const write = (...args: Parameters<typeof fs.promises.writeFile>) =>
  fs.promises.writeFile(...args);
export const rm = (...args: Parameters<typeof fs.promises.rm>) =>
  fs.promises.rm(...args);
export const fromJSON = async (
  json: { [key: string]: string | Uint8Array | null },
  cwd: string,
) => {
  for (const filename in json) {
    const data = json[filename];
    const fullPath = path.resolve(cwd, filename);
    if (data !== null) {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, data);
    } else {
      fs.rmSync(fullPath, { force: true, recursive: true });
    }
  }
};
export const toJSON = (...args: Parameters<typeof vol.toJSON>) =>
  vol.toJSON(...args);

export const printTree = () => {
  console.log(toTreeSync(fs));
};
