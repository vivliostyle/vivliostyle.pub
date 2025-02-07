/// <reference lib="webworker" />
import * as Comlink from 'comlink';

const self = globalThis as unknown as ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

let cli:
  | Comlink.Remote<{
      handle: (
        ...req: ConstructorParameters<typeof Request>
      ) => Promise<ConstructorParameters<typeof Response>>;
    }>
  | undefined;
let workerReady = false;
const workerReadyHandler = new Set<() => void>();

self.addEventListener('message', async (event) => {
  if (event.data.command === 'connect') {
    workerReady = false;
    const port = event.ports[0];
    cli = Comlink.wrap(port);
    Comlink.expose(
      {
        ready: () => {
          workerReady = true;
          for (const handler of workerReadyHandler) {
            handler();
          }
          workerReadyHandler.clear();
        },
      },
      port,
    );
  }
});

const waitWorkerConnection = async () => {
  if (workerReady) {
    return;
  }
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 5000);
    workerReadyHandler.add(() => {
      clearTimeout(timer);
      resolve();
    });
  });
};

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <script type="module">
    const cliWorker = new Worker('/@worker/cli.js');
    const channel = new MessageChannel();
    navigator.serviceWorker.controller?.postMessage({ command: 'connect' }, [channel.port2]);
    cliWorker.postMessage({ command: 'connect' }, [channel.port1]);
  </script>
  <title></title>
  <meta charset="UTF-8">
</head>
<body>
  <script type="module" src="/test.js"></script>
</body>
`;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!cli) {
    return;
  }
  const url = new URL(request.url);
  if (location.origin !== url.origin) {
    return;
  }
  if (!/^sandbox\.*/.test(url.host)) {
    return;
  }
  if ([/\/@worker\/.*/].some((re) => re.test(url.pathname))) {
    return;
  }
  if (request.mode === 'navigate') {
    // Reset the worker's state as the message channel has been closed due to a reload
    workerReady = false;
  }

  event.respondWith(
    (async () => {
      if (request.mode === 'navigate') {
        return new Response(indexHtml, {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
            'Content-Length': `${indexHtml.length}`,
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Resource-Policy': 'cross-origin',
          },
        });
      }

      const requestInit = { ...request } as RequestInit;
      if (
        request.method === 'POST' ||
        request.method === 'PUT' ||
        request.method === 'PATCH'
      ) {
        requestInit.body = await request.arrayBuffer();
      }

      try {
        await waitWorkerConnection();
        const ret = await cli.handle(request.url, requestInit);
        return new Response(...ret);
      } catch {
        return new Response('', { status: 500 });
      }
    })(),
  );
});
