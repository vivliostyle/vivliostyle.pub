/// <reference lib="webworker" />
import * as Comlink from 'comlink';

type WorkerInterface = {
  serve: (
    ...req: ConstructorParameters<typeof Request>
  ) => Promise<ConstructorParameters<typeof Response>>;
};

const self = globalThis as unknown as ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

let workerReady = false;
const workerReadyHandler = new Set<() => void>();

self.addEventListener('message', async (event) => {
  if (event.data.command === 'connect') {
    workerReady = false;
    const port = event.ports[0];
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
  <script type="module" src="/src/test.ts"></script>
</body>
`;

self.addEventListener('fetch', (event) => {
  const { request } = event;
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

  event.respondWith(handleRequest(event));
});

function createChannel() {
  return new BroadcastChannel('vs-cli');
}

async function handleRequest(event: FetchEvent) {
  const { request } = event;
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

  const requestInit: RequestInit = {
    headers: Object.fromEntries(request.headers.entries()),
    method: request.method,
  };
  if (
    request.method === 'POST' ||
    request.method === 'PUT' ||
    request.method === 'PATCH'
  ) {
    requestInit.body = await request.arrayBuffer();
  }

  const channel = createChannel();
  try {
    await waitWorkerConnection();
    const ret = await Promise.race([
      Comlink.wrap<WorkerInterface>(channel).serve(request.url, requestInit),
      new Promise<never>((_, reject) =>
        setTimeout(reject, 5000, new Error('Request timeout')),
      ),
    ]);
    return new Response(...ret);
  } catch (error) {
    console.error(error);
    return new Response('', { status: 500 });
  }
}
