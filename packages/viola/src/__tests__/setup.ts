import { afterEach } from 'vitest';

// All test requests target this sentinel host. The patch below routes them
// to the currently-bound Hono app (`bindApp`) so SDK clients constructed
// anywhere — including viola's `proxies/session.ts` module-init — can reach
// the in-process API server without an HTTP listener.
const TEST_HOST_PREFIX = 'http://test.invalid/';

type AppLike = {
  fetch: (req: Request) => Response | Promise<Response>;
};

let currentApp: AppLike | undefined;

export function bindApp(app: AppLike): void {
  currentApp = app;
}

export function unbindApp(): void {
  currentApp = undefined;
}

const realFetch = globalThis.fetch.bind(globalThis);

const patchedFetch: typeof globalThis.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!url.startsWith(TEST_HOST_PREFIX)) {
    return realFetch(input, init);
  }
  if (!currentApp) {
    throw new Error(
      `Test fetch to ${url} but no app is bound; call bindApp() first`,
    );
  }
  const req =
    input instanceof Request ? new Request(url, input) : new Request(url, init);
  return currentApp.fetch(req);
};

globalThis.fetch = patchedFetch;

afterEach(() => {
  unbindApp();
});
