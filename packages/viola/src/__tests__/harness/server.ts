import { Hono } from 'hono';

import { createApp } from '@v/api-server-reference/app';

// Build a fresh reference API server wrapped under `/api`, matching the
// production layout where viola's `__API_BASE_URL__` already includes the
// `/api` prefix. The wrapper is what gets passed to `bindApp()` — its
// `fetch()` handles the route lookup, so SDK clients hitting
// `http://test.invalid/api/...` reach the same handlers as in dev.
export function buildTestServer() {
  const inner = createApp();
  const root = new Hono();
  root.route('/api', inner.app);
  return { root, inner: inner.app, deps: inner.deps };
}

export type TestServer = ReturnType<typeof buildTestServer>;
