/// <reference lib="webworker" />

import * as Comlink from 'comlink';

import type { ProjectChannel } from '../stores/proxies/project';
import {
  buildRequestInit,
  createHeadResponse,
  serveViaComlink,
  setupSwLifecycle,
} from './sw-utils';

const self = globalThis as unknown as ServiceWorkerGlobalScope;

export function setupSwHost() {
  setupSwLifecycle();

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (location.origin !== url.origin) {
      return;
    }

    if (request.mode === 'navigate') {
      return;
    }

    if (url.pathname.startsWith('/vivliostyle/')) {
      return event.respondWith(handleRequest(event));
    }
  });
}

const channel = new BroadcastChannel('host:project');
const cli = Comlink.wrap<ProjectChannel>(channel);

async function handleRequest(event: FetchEvent) {
  const { request } = event;
  if (request.method === 'HEAD') {
    return createHeadResponse();
  }
  const requestInit = await buildRequestInit(request);
  return serveViaComlink(cli.serve, request.url, requestInit);
}
