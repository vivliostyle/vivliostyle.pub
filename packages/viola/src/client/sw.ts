/// <reference lib="webworker" />

import * as Comlink from 'comlink';

const self = globalThis as unknown as ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    location.origin !== url.origin ||
    !location.hostname.split('.')[0].startsWith('sandbox-') ||
    url.pathname.startsWith('/_cli/')
  ) {
    return;
  }
  if (request.mode === 'navigate') {
    return event.respondWith(handleNavigate(event));
  }

  if (
    ['/__vivliostyle-viewer/', '/vivliostyle/'].some((base) =>
      url.pathname.startsWith(base),
    ) ||
    url.pathname === '/@vivliostyle:viewer:client'
  ) {
    return event.respondWith(handleRequest(event));
  }
});

const channel = new BroadcastChannel('worker:cli');

async function handleNavigate(event: FetchEvent) {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname === '/sandbox') {
    const iframeHtml = import.meta.env.VITE_IFRAME_HTML;
    return new Response(iframeHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Content-Length': `${iframeHtml.length}`,
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  }

  if (url.pathname.startsWith('/__vivliostyle-viewer/')) {
    url.hostname = url.hostname.split('.').slice(1).join('.');
    url.pathname = '/_cli/viewer/index.html';
    const viewerHtml = await fetch(url, { mode: 'cors' }).then((res) =>
      res.text(),
    );
    return new Response(viewerHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Content-Length': `${viewerHtml.length}`,
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  }

  return new Response(null, { status: 404 });
}

async function handleRequest(event: FetchEvent) {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/__vivliostyle-viewer/')) {
    url.hostname = url.hostname.split('.').slice(1).join('.');
    url.pathname = `/_cli/viewer${url.pathname.slice('/__vivliostyle-viewer'.length)}`;
    return fetch(url, { mode: 'no-cors' });
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
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  }

  try {
    const ret = await Promise.race([
      Comlink.wrap<typeof import('@v/cli-bundle')>(channel).serve(
        request.url,
        requestInit,
      ),
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
