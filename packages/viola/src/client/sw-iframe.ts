/// <reference lib="webworker" />

import * as Comlink from 'comlink';

import {
  buildRequestInit,
  createHeadResponse,
  serveViaComlink,
  setupSwLifecycle,
} from './sw-utils';

const self = globalThis as unknown as ServiceWorkerGlobalScope;

export function setupSwIframe() {
  setupSwLifecycle();

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    // The sandbox origin serves the app's static assets itself. Leaving the
    // stage navigation to the network keeps its document under this worker.
    if (
      location.origin !== url.origin ||
      ['/_cli/', '/_viewer/'].some((base) => url.pathname.startsWith(base))
    ) {
      return;
    }
    if (request.mode === 'navigate') {
      return event.respondWith(handleNavigate(event));
    }

    if (url.pathname.startsWith('/vivliostyle/')) {
      return event.respondWith(handleRequest(event));
    }
  });
}

const channel = new BroadcastChannel('worker:cli');
const cli = Comlink.wrap<typeof import('@v/cli-bundle')>(channel);

async function handleNavigate(event: FetchEvent) {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname === '/sandbox' || url.pathname.startsWith('/extension')) {
    const iframeHtml = import.meta.env.VITE_IFRAME_HTML;
    return new Response(iframeHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Content-Length': `${iframeHtml.length}`,
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  }

  return new Response(null, { status: 404 });
}

async function handleRequest(event: FetchEvent) {
  const { request } = event;
  if (request.method === 'HEAD') {
    return createHeadResponse();
  }
  const requestInit = await buildRequestInit(request);
  return serveViaComlink(cli.serve, request.url, requestInit);
}
