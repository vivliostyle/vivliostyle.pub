/// <reference lib="webworker" />

const self = globalThis as unknown as ServiceWorkerGlobalScope;

const coepHeaders = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export function setupSwLifecycle() {
  self.addEventListener('install', (event: ExtendableEvent) => {
    event.waitUntil(self.skipWaiting());
  });
  self.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(self.clients.claim());
  });
}

export function createHeadResponse() {
  return new Response(null, { status: 200, headers: coepHeaders });
}

export async function buildRequestInit(request: Request): Promise<RequestInit> {
  const requestInit: RequestInit = {
    headers: Object.fromEntries(request.headers.entries()),
    method: request.method,
  };
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    requestInit.body = await request.arrayBuffer();
  }
  return requestInit;
}

type ServeFunction = (
  url: string,
  init: RequestInit,
) => Promise<ConstructorParameters<typeof Response>>;

export async function serveViaComlink(
  serve: ServeFunction,
  url: string,
  requestInit: RequestInit,
): Promise<Response> {
  try {
    const ret = await Promise.race([
      serve(url, requestInit),
      new Promise<never>((_, reject) =>
        setTimeout(reject, 5000, new Error(`Request timeout: ${url}`)),
      ),
    ]);
    return new Response(...ret);
  } catch (error) {
    console.error(error);
    return new Response('', { status: 500 });
  }
}
