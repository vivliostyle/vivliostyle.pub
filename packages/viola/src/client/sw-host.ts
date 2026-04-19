/// <reference lib="webworker" />

import * as Comlink from 'comlink';

const self = globalThis as unknown as ServiceWorkerGlobalScope;

export function setupSwHost() {
  self.addEventListener('install', (event: ExtendableEvent) => {
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (location.origin !== url.origin) {
      return;
    }

    if (request.mode === 'navigate') {
      return;
    }

    // TODO
  });
}
