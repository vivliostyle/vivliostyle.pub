/// <reference lib="webworker" />

import type {
  ProjectServeRequest,
  ProjectServeResponse,
} from '../stores/proxies/project';
import {
  buildRequestInit,
  createHeadResponse,
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

    if (
      url.pathname.startsWith('/vivliostyle/') ||
      url.pathname === '/@vivliostyle:viewer:client'
    ) {
      return event.respondWith(handleRequest(event));
    }
  });
}

const channel = new BroadcastChannel('host:project');
const pending = new Map<
  string,
  (result: ConstructorParameters<typeof Response>) => void
>();
channel.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as Partial<ProjectServeResponse> | undefined;
  if (data?.type !== 'vs:project-serve-result' || !data.id || !data.result) {
    return;
  }
  const resolve = pending.get(data.id);
  if (resolve) {
    pending.delete(data.id);
    resolve(data.result);
  }
});

// Broadcast the request to every tab; only the tab owning the requested
// project replies (see `serveProjectResource`), so first-reply-wins is safe.
async function serveViaProjectChannel(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    const result = await new Promise<ConstructorParameters<typeof Response>>(
      (resolve, reject) => {
        const id = crypto.randomUUID();
        pending.set(id, resolve);
        setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`Request timeout: ${url}`));
          }
        }, 5000);
        channel.postMessage({
          type: 'vs:project-serve',
          id,
          url,
          init,
        } satisfies ProjectServeRequest);
      },
    );
    return new Response(...result);
  } catch (error) {
    console.error(error);
    return new Response('', { status: 500 });
  }
}

async function handleRequest(event: FetchEvent) {
  const { request } = event;
  if (request.method === 'HEAD') {
    return createHeadResponse();
  }
  const requestInit = await buildRequestInit(request);
  return serveViaProjectChannel(request.url, requestInit);
}
